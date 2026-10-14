import { and, desc, eq } from 'drizzle-orm';
import { requiredLessonIds } from '../../../shared/src/content';
import type { Db } from '../db';
import {
  completions,
  courses,
  courseVersions,
  credentials,
  enrollments,
  lessonProgress,
  quizAttempts,
  reviews,
  submissions,
  users,
  type CompletionEvidence,
} from '../db/schema';
import { audit } from '../lib/audit';
import { publicId } from '../lib/crypto';
import { allocateOnCompletion } from '../rewards/service';

export interface CompletionOutcome {
  completed: boolean;
  /** True only on the call that recorded the completion. */
  newlyCompleted: boolean;
  credentialPublicId: string | null;
}

/**
 * Checks every completion condition on the server and, when all hold, records
 * the completion, issues the credential and allocates rewards in one transaction.
 * Safe to call after any learner or reviewer action; it is idempotent.
 */
export async function evaluateCompletion(
  tx: Db,
  enrollmentId: string,
  actor: { id: string; ip: string | null },
): Promise<CompletionOutcome> {
  const [enrollment] = await tx.select().from(enrollments).where(eq(enrollments.id, enrollmentId)).for('update');
  if (!enrollment) return { completed: false, newlyCompleted: false, credentialPublicId: null };

  const [existing] = await tx
    .select({ id: completions.id })
    .from(completions)
    .where(and(eq(completions.userId, enrollment.userId), eq(completions.courseId, enrollment.courseId)));
  if (existing) {
    const [cred] = await tx.select({ publicId: credentials.publicId }).from(credentials).where(eq(credentials.completionId, existing.id));
    return { completed: true, newlyCompleted: false, credentialPublicId: cred?.publicId ?? null };
  }

  const [version] = await tx.select().from(courseVersions).where(eq(courseVersions.id, enrollment.versionId));
  const content = version!.content;
  const evidence: CompletionEvidence = { lessonsCompleted: 0 };

  const done = await tx.select({ lessonId: lessonProgress.lessonId }).from(lessonProgress).where(eq(lessonProgress.enrollmentId, enrollment.id));
  const doneIds = new Set(done.map((d) => d.lessonId));
  evidence.lessonsCompleted = doneIds.size;
  if (content.completion.requireAllLessons && !requiredLessonIds(content).every((id) => doneIds.has(id))) {
    return { completed: false, newlyCompleted: false, credentialPublicId: null };
  }

  if (content.completion.requireQuiz) {
    if (!content.quiz) return { completed: false, newlyCompleted: false, credentialPublicId: null };
    const [pass] = await tx
      .select({ id: quizAttempts.id, score: quizAttempts.scorePercent })
      .from(quizAttempts)
      .where(and(eq(quizAttempts.enrollmentId, enrollment.id), eq(quizAttempts.quizId, content.quiz.id), eq(quizAttempts.passed, true)))
      .orderBy(desc(quizAttempts.scorePercent))
      .limit(1);
    if (!pass) return { completed: false, newlyCompleted: false, credentialPublicId: null };
    evidence.quizAttemptId = pass.id;
    evidence.quizScore = pass.score ?? undefined;
  }

  if (content.completion.requireAssignment) {
    if (!content.assignment) return { completed: false, newlyCompleted: false, credentialPublicId: null };
    const [approved] = await tx
      .select({ id: submissions.id })
      .from(submissions)
      .where(and(eq(submissions.enrollmentId, enrollment.id), eq(submissions.status, 'approved')))
      .limit(1);
    if (!approved) return { completed: false, newlyCompleted: false, credentialPublicId: null };
    const [review] = await tx
      .select({ id: reviews.id })
      .from(reviews)
      .where(and(eq(reviews.submissionId, approved.id), eq(reviews.decision, 'approved')))
      .orderBy(desc(reviews.createdAt))
      .limit(1);
    evidence.submissionId = approved.id;
    evidence.reviewId = review?.id;
  }

  const now = new Date();
  const [completion] = await tx
    .insert(completions)
    .values({
      userId: enrollment.userId,
      courseId: enrollment.courseId,
      communityId: enrollment.communityId,
      versionId: enrollment.versionId,
      enrollmentId: enrollment.id,
      evidence,
      completedAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (!completion) return { completed: true, newlyCompleted: false, credentialPublicId: null };
  await tx.update(enrollments).set({ completedAt: now, lastActivityAt: now }).where(eq(enrollments.id, enrollment.id));
  await audit(tx, {
    action: 'completion.create',
    actorId: actor.id,
    communityId: enrollment.communityId,
    targetType: 'completion',
    targetId: completion.id,
    metadata: { learnerId: enrollment.userId, courseId: enrollment.courseId, versionNumber: version!.versionNumber, ...evidence },
    ip: actor.ip,
  });

  let credentialPublicId: string | null = null;
  if (content.credential.enabled) {
    const [learner] = await tx.select({ displayName: users.displayName }).from(users).where(eq(users.id, enrollment.userId));
    const [course] = await tx.select({ title: courses.title }).from(courses).where(eq(courses.id, enrollment.courseId));
    credentialPublicId = publicId('cred');
    await tx.insert(credentials).values({
      publicId: credentialPublicId,
      completionId: completion.id,
      userId: enrollment.userId,
      communityId: enrollment.communityId,
      courseId: enrollment.courseId,
      versionId: enrollment.versionId,
      versionNumber: version!.versionNumber,
      recipientName: learner!.displayName,
      title: content.credential.title || `${course!.title} completion`,
      courseTitle: course!.title,
      criteria: content.credential.criteria || defaultCriteria(content),
      issuedAt: now,
    });
    await audit(tx, {
      action: 'credential.issue',
      actorId: actor.id,
      communityId: enrollment.communityId,
      targetType: 'credential',
      targetId: credentialPublicId,
      ip: actor.ip,
    });
  }

  await allocateOnCompletion(tx, {
    userId: enrollment.userId,
    courseId: enrollment.courseId,
    communityId: enrollment.communityId,
    enrollmentId: enrollment.id,
    completionId: completion.id,
  });

  return { completed: true, newlyCompleted: true, credentialPublicId };
}

function defaultCriteria(content: typeof courseVersions.$inferSelect['content']): string {
  const parts: string[] = [];
  if (content.completion.requireAllLessons) parts.push('completed every required lesson');
  if (content.completion.requireQuiz && content.quiz) parts.push(`scored at least ${content.quiz.passPercent}% on the assessment`);
  if (content.completion.requireAssignment && content.assignment) parts.push('had a practical assignment approved against a rubric');
  return parts.length ? `The recipient ${parts.join(', ')}.` : 'The recipient met the course completion requirements.';
}
