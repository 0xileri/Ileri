import crypto from 'node:crypto';
import { and, asc, count, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { allLessons, completionRequirementText, type CourseContent } from '../../../shared/src/content';
import { assertGranted, courseAccess, requirementsFor } from '../access/requirements';
import type { AuthUser } from '../auth/session';
import { joinCommunity } from '../communities/routes';
import type { AppContext } from '../context';
import { loadCourse } from '../courses/routes';
import {
  appeals,
  communities,
  completions,
  courses,
  courseVersions,
  credentials,
  enrollments,
  lessonProgress,
  media,
  memberships,
  quizAttempts,
  reviews,
  rewardCampaigns,
  rewardEntitlements,
  submissions,
  type AttemptAnswers,
} from '../db/schema';
import type { Db } from '../db';
import { audit } from '../lib/audit';
import { sha256 } from '../lib/crypto';
import { AppError, badRequest, conflict, notFound } from '../lib/errors';
import { parse } from '../lib/validate';
import { signedMediaUrl } from '../media/sign';
import { activeMembership, isStaffRole, requireUser } from '../permissions';
import { balanceOf, liveCampaignsByCourse, postLedger, reserveAtEnrollment } from '../rewards/service';
import { evaluateCompletion } from './completion';
import { computeProgress, computeStage, enrollmentSummaries, type ProgressState } from './summary';

type Enrollment = typeof enrollments.$inferSelect;

async function myEnrollment(db: Db, userId: string, courseId: string): Promise<Enrollment | null> {
  const [row] = await db
    .select()
    .from(enrollments)
    .where(and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId)))
    .limit(1);
  return row ?? null;
}

async function versionContent(db: Db, versionId: string): Promise<{ versionNumber: number; content: CourseContent }> {
  const [row] = await db
    .select({ versionNumber: courseVersions.versionNumber, content: courseVersions.content })
    .from(courseVersions)
    .where(eq(courseVersions.id, versionId));
  if (!row) throw notFound('Course version');
  return row;
}

/** Loads the enrollment and enforces live access. Used by every protected learner route. */
async function protectedContext(ctx: AppContext, user: AuthUser, courseId: string) {
  const { course, community } = await loadCourse(ctx, courseId);
  const enrollment = await myEnrollment(ctx.db, user.id, course.id);
  if (!enrollment) throw new AppError(404, 'not_enrolled', 'Enroll in this course first.');
  const decision = await courseAccess(ctx, user, community, course);
  assertGranted(decision);
  const { content, versionNumber } = await versionContent(ctx.db, enrollment.versionId);
  return { course, community, enrollment, content, versionNumber };
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const SUBMISSION_MIN_HASH_LENGTH = 40;

function normalizeForHash(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').trim();
}

export async function learningRoutes(app: FastifyInstance) {
  const { ctx } = app;

  // --- Enrollment ------------------------------------------------------------

  app.post<{ Params: { id: string } }>('/courses/:id/enroll', async (req) => {
    const user = requireUser(req);
    const { course, community } = await loadCourse(ctx, req.params.id);
    const existing = await myEnrollment(ctx.db, user.id, course.id);
    if (existing) return { enrollment: existing, alreadyEnrolled: true };
    if (course.status !== 'published' || !course.currentVersionId) {
      throw conflict(course.status === 'archived' ? 'This course is no longer accepting enrollments.' : 'This course is not published yet.', 'not_open');
    }
    if (community.status !== 'active') throw new AppError(403, 'suspended', 'This community is currently suspended.');

    let membership = await activeMembership(ctx.db, community.id, user.id);
    if (!membership) membership = await joinCommunity(app, community, user, req.ip);
    const decision = await courseAccess(ctx, user, community, course, membership);
    if (decision.state === 'denied' && decision.reason === 'policy') {
      throw new AppError(403, 'not_eligible', "You don't meet this course's requirements yet.", {
        requirements: decision.requirements,
      });
    }
    assertGranted(decision);
    const staff = isStaffRole(membership.role) || user.isPlatformAdmin;

    const enrollment = await ctx.db.transaction(async (tx) => {
      // Serialise credit spending per learner and community.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`credits:${user.id}:${community.id}`}))`);
      const [row] = await tx
        .insert(enrollments)
        .values({ userId: user.id, courseId: course.id, communityId: community.id, versionId: course.currentVersionId! })
        .onConflictDoNothing()
        .returning();
      if (!row) return (await myEnrollment(tx, user.id, course.id))!;
      if (course.creditCost > 0 && !staff) {
        const balance = await balanceOf(tx, user.id, community.id, 'course_credits');
        if (balance < course.creditCost) {
          throw new AppError(402, 'insufficient_credits', `This course costs ${course.creditCost} course credits. You have ${balance}.`, {
            cost: course.creditCost,
            balance,
          });
        }
        await postLedger(tx, {
          userId: user.id,
          communityId: community.id,
          kind: 'course_credits',
          amount: -course.creditCost,
          reason: 'enrollment',
          sourceType: 'enrollment',
          sourceId: row.id,
          memo: course.title,
          createdBy: user.id,
        });
      }
      await reserveAtEnrollment(tx, { userId: user.id, courseId: course.id, communityId: community.id, enrollmentId: row.id });
      await audit(tx, {
        action: 'enrollment.create',
        actorId: user.id,
        communityId: community.id,
        targetType: 'course',
        targetId: course.id,
        metadata: { versionId: row.versionId, creditCost: staff ? 0 : course.creditCost },
        ip: req.ip,
      });
      return row;
    });
    return { enrollment, alreadyEnrolled: false };
  });

  // --- Learner dashboard -----------------------------------------------------

  app.get('/me/dashboard', async (req) => {
    const user = requireUser(req);
    const summaries = await enrollmentSummaries(ctx.db, user.id);
    const enrolledIds = [...summaries.keys()];
    const enrolledCourses = enrolledIds.length
      ? await ctx.db
          .select({
            id: courses.id,
            title: courses.title,
            summary: courses.summary,
            coverUrl: courses.coverUrl,
            communityId: communities.id,
            communityName: communities.name,
            communitySlug: communities.slug,
            accentColor: communities.accentColor,
          })
          .from(courses)
          .innerJoin(communities, eq(communities.id, courses.communityId))
          .where(inArray(courses.id, enrolledIds))
      : [];

    // Published courses in my communities that I have not started.
    const myCommunities = await ctx.db
      .select({ community: communities, role: memberships.role })
      .from(memberships)
      .innerJoin(communities, eq(communities.id, memberships.communityId))
      .where(and(eq(memberships.userId, user.id), eq(memberships.status, 'active'), eq(communities.status, 'active')));
    const communityIds = myCommunities.map((m) => m.community.id);
    const candidates = communityIds.length
      ? await ctx.db
          .select()
          .from(courses)
          .where(and(inArray(courses.communityId, communityIds), eq(courses.status, 'published')))
          .orderBy(desc(courses.updatedAt))
          .limit(60)
      : [];
    const notStarted = candidates.filter((c) => !summaries.has(c.id)).slice(0, 24);
    const communityById = new Map(myCommunities.map((m) => [m.community.id, m]));
    const campaigns = await liveCampaignsByCourse(ctx.db, notStarted.map((c) => c.id));
    const available = await Promise.all(
      notStarted.map(async (c) => {
        const entry = communityById.get(c.communityId)!;
        const requirements = isStaffRole(entry.role)
          ? null
          : await requirementsFor(ctx, [entry.community.joinPolicy, c.accessPolicy], user);
        return {
          id: c.id,
          title: c.title,
          summary: c.summary,
          coverUrl: c.coverUrl,
          creditCost: c.creditCost,
          communityName: entry.community.name,
          communitySlug: entry.community.slug,
          accentColor: entry.community.accentColor,
          eligibility: requirements ? requirements.state : 'eligible',
          accessSummary: requirements?.summary ?? 'Staff access',
          campaigns: campaigns.get(c.id) ?? [],
        };
      }),
    );

    const creds = await ctx.db
      .select({
        publicId: credentials.publicId,
        title: credentials.title,
        courseTitle: credentials.courseTitle,
        issuedAt: credentials.issuedAt,
        status: credentials.status,
        communityName: communities.name,
      })
      .from(credentials)
      .innerJoin(communities, eq(communities.id, credentials.communityId))
      .where(eq(credentials.userId, user.id))
      .orderBy(desc(credentials.issuedAt));
    const [{ claimable }] = (await ctx.db
      .select({ claimable: count() })
      .from(rewardEntitlements)
      .where(and(eq(rewardEntitlements.userId, user.id), eq(rewardEntitlements.status, 'eligible')))) as [{ claimable: number }];

    const learning = enrolledCourses
      .map((c) => ({ ...c, enrollment: summaries.get(c.id)! }))
      .sort((a, b) => b.enrollment.lastActivityAt.getTime() - a.enrollment.lastActivityAt.getTime());
    return {
      continueLearning: learning.filter((l) => l.enrollment.stage !== 'completed'),
      completed: learning.filter((l) => l.enrollment.stage === 'completed'),
      available,
      credentials: creds,
      claimableRewards: claimable,
    };
  });

  // --- Course player ---------------------------------------------------------

  app.get<{ Params: { id: string } }>('/courses/:id/learn', async (req) => {
    const user = requireUser(req);
    const { course, community } = await loadCourse(ctx, req.params.id);
    const enrollment = await myEnrollment(ctx.db, user.id, course.id);
    if (!enrollment) throw new AppError(404, 'not_enrolled', 'Enroll in this course first.');
    const access = await courseAccess(ctx, user, community, course);
    const granted = access.state === 'granted';
    const { content, versionNumber } = await versionContent(ctx.db, enrollment.versionId);

    const [progressRows, attempts, subs, completion, entitlements] = await Promise.all([
      ctx.db.select().from(lessonProgress).where(eq(lessonProgress.enrollmentId, enrollment.id)),
      ctx.db.select().from(quizAttempts).where(eq(quizAttempts.enrollmentId, enrollment.id)).orderBy(asc(quizAttempts.startedAt)),
      ctx.db.select().from(submissions).where(eq(submissions.enrollmentId, enrollment.id)).orderBy(desc(submissions.attemptNumber)),
      ctx.db.select().from(completions).where(and(eq(completions.userId, user.id), eq(completions.courseId, course.id))),
      ctx.db
        .select({ entitlement: rewardEntitlements, campaignName: rewardCampaigns.name, rewardKind: rewardCampaigns.rewardKind })
        .from(rewardEntitlements)
        .innerJoin(rewardCampaigns, eq(rewardCampaigns.id, rewardEntitlements.campaignId))
        .where(and(eq(rewardEntitlements.userId, user.id), eq(rewardEntitlements.courseId, course.id))),
    ]);
    const subIds = subs.map((s) => s.id);
    const [reviewRows, appealRows] = subIds.length
      ? await Promise.all([
          ctx.db.select().from(reviews).where(inArray(reviews.submissionId, subIds)).orderBy(asc(reviews.createdAt)),
          ctx.db.select().from(appeals).where(inArray(appeals.submissionId, subIds)),
        ])
      : [[], []];
    const done = new Set(progressRows.map((p) => p.lessonId));
    const submitted = attempts.filter((a) => a.submittedAt);
    const quizPassed = submitted.some((a) => a.passed);
    const latest = subs[0];
    const completionRow = completion[0];
    const [credential] = completionRow
      ? await ctx.db.select({ publicId: credentials.publicId, status: credentials.status }).from(credentials).where(eq(credentials.completionId, completionRow.id))
      : [];
    const state: ProgressState = {
      completedLessonIds: done,
      quizPassed,
      hasQuizAttempt: attempts.length > 0,
      latestSubmissionStatus: latest?.status ?? null,
      completed: completionRow?.status === 'valid',
    };
    const progress = computeProgress(content, state);
    const quiz = content.quiz;
    const lastSubmitted = submitted.at(-1);
    const cooldownUntil =
      quiz && lastSubmitted && !quizPassed && quiz.cooldownMinutes > 0
        ? new Date(lastSubmitted.submittedAt!.getTime() + quiz.cooldownMinutes * 60_000)
        : null;

    return {
      course: { id: course.id, title: course.title, summary: course.summary, status: course.status },
      community: { id: community.id, slug: community.slug, name: community.name, accentColor: community.accentColor, logoUrl: community.logoUrl },
      version: { id: enrollment.versionId, versionNumber, isCurrent: enrollment.versionId === course.currentVersionId },
      access:
        access.state === 'granted'
          ? { state: 'granted' as const }
          : { state: access.state, message: access.message, requirements: access.requirements },
      stage: computeStage(state),
      progress,
      lastLessonId: enrollment.lastLessonId,
      requirements: completionRequirementText(content),
      modules: content.modules.map((m) => ({
        id: m.id,
        title: m.title,
        lessons: m.lessons.map((l) => ({
          id: l.id,
          title: l.title,
          kind: l.kind,
          estimatedMinutes: l.estimatedMinutes,
          required: l.required,
          completed: done.has(l.id),
        })),
      })),
      quiz: quiz
        ? {
            title: quiz.title,
            required: content.completion.requireQuiz,
            passPercent: quiz.passPercent,
            questionsPerAttempt: quiz.questionsPerAttempt,
            maxAttempts: quiz.maxAttempts,
            attemptsUsed: submitted.length,
            bestScore: submitted.reduce<number | null>((m, a) => Math.max(m ?? 0, a.scorePercent ?? 0), null),
            passed: quizPassed,
            openAttemptId: attempts.find((a) => !a.submittedAt)?.id ?? null,
            cooldownUntil: cooldownUntil && cooldownUntil > new Date() ? cooldownUntil : null,
            history: submitted.map((a) => ({ id: a.id, scorePercent: a.scorePercent, passed: a.passed, submittedAt: a.submittedAt })),
          }
        : null,
      assignment: content.assignment
        ? {
            title: content.assignment.title,
            required: content.completion.requireAssignment,
            prompt: granted ? content.assignment.prompt : null,
            allowLink: content.assignment.allowLink,
            allowFile: content.assignment.allowFile,
            rubric: content.assignment.rubric.map((c) => ({ id: c.id, title: c.title, description: c.description, required: c.required })),
            submissions: subs.map((s) => ({
              id: s.id,
              attemptNumber: s.attemptNumber,
              status: s.status,
              text: s.text,
              linkUrl: s.linkUrl,
              file: s.mediaId ? { url: signedMediaUrl(ctx, s.mediaId) } : null,
              createdAt: s.createdAt,
              decidedAt: s.decidedAt,
              reviews: reviewRows
                .filter((r) => r.submissionId === s.id)
                .map((r) => ({ decision: r.decision, comment: r.comment, rubric: r.rubric, createdAt: r.createdAt, viaAppeal: r.viaAppeal })),
              appeal: (() => {
                const a = appealRows.find((x) => x.submissionId === s.id);
                return a ? { status: a.status, reason: a.reason, resolutionNote: a.resolutionNote, createdAt: a.createdAt } : null;
              })(),
            })),
          }
        : null,
      completion: completionRow
        ? {
            status: completionRow.status,
            completedAt: completionRow.completedAt,
            credential: credential ?? null,
          }
        : null,
      rewards: entitlements.map((e) => ({
        id: e.entitlement.id,
        campaignName: e.campaignName,
        rewardKind: e.rewardKind,
        amount: e.entitlement.amount,
        status: e.entitlement.status,
        note: e.entitlement.note,
      })),
    };
  });

  app.get<{ Params: { id: string; lessonId: string } }>('/courses/:id/lessons/:lessonId', async (req) => {
    const user = requireUser(req);
    const { enrollment, content } = await protectedContext(ctx, user, req.params.id);
    const lessons = allLessons(content);
    const index = lessons.findIndex((l) => l.id === req.params.lessonId);
    if (index === -1) throw notFound('Lesson');
    const lesson = lessons[index]!;
    await ctx.db
      .update(enrollments)
      .set({ lastLessonId: lesson.id, lastActivityAt: new Date() })
      .where(eq(enrollments.id, enrollment.id));
    const [progress] = await ctx.db
      .select()
      .from(lessonProgress)
      .where(and(eq(lessonProgress.enrollmentId, enrollment.id), eq(lessonProgress.lessonId, lesson.id)));
    const fileIds = [lesson.mediaId, ...lesson.attachments.map((a) => a.mediaId)].filter((x): x is string => Boolean(x));
    const files = fileIds.length
      ? await ctx.db.select({ id: media.id, mimeType: media.mimeType }).from(media).where(inArray(media.id, fileIds))
      : [];
    return {
      lesson: {
        id: lesson.id,
        title: lesson.title,
        kind: lesson.kind,
        body: lesson.body,
        videoUrl: lesson.videoUrl || null,
        video: lesson.mediaId
          ? { url: signedMediaUrl(ctx, lesson.mediaId), mimeType: files.find((f) => f.id === lesson.mediaId)?.mimeType ?? 'video/mp4' }
          : null,
        attachments: lesson.attachments.map((a) => ({ name: a.name, url: signedMediaUrl(ctx, a.mediaId) })),
        estimatedMinutes: lesson.estimatedMinutes,
        required: lesson.required,
        completed: Boolean(progress),
      },
      previousLessonId: lessons[index - 1]?.id ?? null,
      nextLessonId: lessons[index + 1]?.id ?? null,
    };
  });

  app.post<{ Params: { id: string; lessonId: string } }>('/courses/:id/lessons/:lessonId/complete', async (req) => {
    const user = requireUser(req);
    const { enrollment, content } = await protectedContext(ctx, user, req.params.id);
    if (!allLessons(content).some((l) => l.id === req.params.lessonId)) throw notFound('Lesson');
    const outcome = await ctx.db.transaction(async (tx) => {
      await tx.insert(lessonProgress).values({ enrollmentId: enrollment.id, lessonId: req.params.lessonId }).onConflictDoNothing();
      await tx.update(enrollments).set({ lastActivityAt: new Date() }).where(eq(enrollments.id, enrollment.id));
      return evaluateCompletion(tx, enrollment.id, { id: user.id, ip: req.ip });
    });
    return { ok: true, courseCompleted: outcome.completed, newlyCompleted: outcome.newlyCompleted, credentialPublicId: outcome.credentialPublicId };
  });

  // --- Quiz ------------------------------------------------------------------

  app.post<{ Params: { id: string } }>('/courses/:id/quiz/attempts', async (req) => {
    const user = requireUser(req);
    const { enrollment, content, course } = await protectedContext(ctx, user, req.params.id);
    const quiz = content.quiz;
    if (!quiz) throw notFound('Quiz');
    const attempt = await ctx.db.transaction(async (tx) => {
      await tx.select({ id: enrollments.id }).from(enrollments).where(eq(enrollments.id, enrollment.id)).for('update');
      const attempts = await tx
        .select()
        .from(quizAttempts)
        .where(and(eq(quizAttempts.enrollmentId, enrollment.id), eq(quizAttempts.quizId, quiz.id)))
        .orderBy(asc(quizAttempts.startedAt));
      const open = attempts.find((a) => !a.submittedAt);
      if (open) return open;
      const submitted = attempts.filter((a) => a.submittedAt);
      if (submitted.some((a) => a.passed)) throw conflict('You have already passed this quiz.', 'already_passed');
      if (submitted.length >= quiz.maxAttempts) {
        throw conflict(
          `You've used all ${quiz.maxAttempts} attempts. Contact the community if you think you need another.`,
          'attempts_exhausted',
        );
      }
      const last = submitted.at(-1);
      if (last && quiz.cooldownMinutes > 0) {
        const retryAt = new Date(last.submittedAt!.getTime() + quiz.cooldownMinutes * 60_000);
        if (retryAt > new Date()) {
          throw new AppError(409, 'cooldown', `You can try again after ${retryAt.toISOString()}.`, { retryAt });
        }
      }
      const picked = shuffle(quiz.questions).slice(0, quiz.questionsPerAttempt);
      const [row] = await tx
        .insert(quizAttempts)
        .values({
          enrollmentId: enrollment.id,
          userId: user.id,
          courseId: course.id,
          versionId: enrollment.versionId,
          quizId: quiz.id,
          questions: picked.map((q) => ({ questionId: q.id, optionOrder: shuffle(q.options.map((o) => o.id)) })),
        })
        .returning();
      return row!;
    });
    const byId = new Map(quiz.questions.map((q) => [q.id, q]));
    return {
      attempt: {
        id: attempt.id,
        startedAt: attempt.startedAt,
        // Correct answers never leave the server.
        questions: attempt.questions.map((aq) => {
          const q = byId.get(aq.questionId)!;
          return {
            id: q.id,
            prompt: q.prompt,
            kind: q.kind,
            options: aq.optionOrder.map((oid) => ({ id: oid, text: q.options.find((o) => o.id === oid)!.text })),
          };
        }),
      },
    };
  });

  app.post<{ Params: { attemptId: string } }>('/quiz-attempts/:attemptId/submit', async (req) => {
    const user = requireUser(req);
    const body = parse(
      z.object({ answers: z.record(z.string().max(64), z.array(z.string().max(64)).max(8)) }),
      req.body,
    );
    if (!/^[0-9a-f-]{36}$/i.test(req.params.attemptId)) throw notFound('Quiz attempt');
    const [attempt] = await ctx.db
      .select()
      .from(quizAttempts)
      .where(and(eq(quizAttempts.id, req.params.attemptId), eq(quizAttempts.userId, user.id)));
    if (!attempt) throw notFound('Quiz attempt');
    if (attempt.submittedAt) throw conflict('This attempt was already submitted.', 'already_submitted');
    const { content, enrollment } = await protectedContext(ctx, user, attempt.courseId);
    const quiz = content.quiz;
    if (!quiz || quiz.id !== attempt.quizId) throw notFound('Quiz');
    const byId = new Map(quiz.questions.map((q) => [q.id, q]));
    const answers: AttemptAnswers = {};
    let correct = 0;
    for (const aq of attempt.questions) {
      const q = byId.get(aq.questionId);
      if (!q) continue;
      const chosen = [...new Set(body.answers[aq.questionId] ?? [])].filter((id) => aq.optionOrder.includes(id));
      answers[aq.questionId] = chosen;
      const expected = q.options.filter((o) => o.correct).map((o) => o.id);
      if (chosen.length === expected.length && expected.every((id) => chosen.includes(id))) correct += 1;
    }
    const total = attempt.questions.length;
    const scorePercent = total === 0 ? 0 : Math.round((correct / total) * 100);
    const passed = scorePercent >= quiz.passPercent;
    const outcome = await ctx.db.transaction(async (tx) => {
      const updated = await tx
        .update(quizAttempts)
        .set({ answers, scorePercent, passed, submittedAt: new Date() })
        .where(and(eq(quizAttempts.id, attempt.id), isNull(quizAttempts.submittedAt)))
        .returning({ id: quizAttempts.id });
      if (!updated.length) throw conflict('This attempt was already submitted.', 'already_submitted');
      await tx.update(enrollments).set({ lastActivityAt: new Date() }).where(eq(enrollments.id, enrollment.id));
      return passed ? evaluateCompletion(tx, enrollment.id, { id: user.id, ip: req.ip }) : null;
    });
    const [{ used }] = (await ctx.db
      .select({ used: count() })
      .from(quizAttempts)
      .where(and(eq(quizAttempts.enrollmentId, enrollment.id), eq(quizAttempts.quizId, quiz.id)))) as [{ used: number }];
    return {
      result: {
        scorePercent,
        passed,
        correct,
        total,
        passPercent: quiz.passPercent,
        attemptsRemaining: passed ? 0 : Math.max(0, quiz.maxAttempts - used),
        courseCompleted: outcome?.completed ?? false,
        credentialPublicId: outcome?.credentialPublicId ?? null,
      },
    };
  });

  // --- Practical assignment ---------------------------------------------------

  app.post<{ Params: { id: string } }>('/courses/:id/submissions', async (req) => {
    const user = requireUser(req);
    const { enrollment, content, course, community } = await protectedContext(ctx, user, req.params.id);
    const assignment = content.assignment;
    if (!assignment) throw notFound('Assignment');
    const body = parse(
      z.object({
        text: z.string().max(20_000).default(''),
        linkUrl: z
          .union([z.literal(''), z.url({ protocol: /^https?$/ }).max(2000)])
          .nullable()
          .default(null),
        mediaId: z.uuid().nullable().default(null),
      }),
      req.body,
    );
    const text = body.text.trim();
    const linkUrl = body.linkUrl || null;
    if (linkUrl && !assignment.allowLink) throw badRequest('This assignment does not accept links.');
    if (body.mediaId && !assignment.allowFile) throw badRequest('This assignment does not accept file uploads.');
    if (!text && !linkUrl && !body.mediaId) throw badRequest('Add a written response, a link or a file before submitting.');
    if (body.mediaId) {
      const [file] = await ctx.db
        .select({ id: media.id })
        .from(media)
        .where(and(eq(media.id, body.mediaId), eq(media.uploadedBy, user.id), eq(media.courseId, course.id), eq(media.purpose, 'submission')));
      if (!file) throw badRequest('Upload the file for this course first.');
    }
    const contentHash = text.length >= SUBMISSION_MIN_HASH_LENGTH ? sha256(normalizeForHash(text)) : null;

    const submission = await ctx.db.transaction(async (tx) => {
      await tx.select({ id: enrollments.id }).from(enrollments).where(eq(enrollments.id, enrollment.id)).for('update');
      const [latest] = await tx
        .select()
        .from(submissions)
        .where(eq(submissions.enrollmentId, enrollment.id))
        .orderBy(desc(submissions.attemptNumber))
        .limit(1);
      if (latest?.status === 'submitted' || latest?.status === 'under_review') {
        throw conflict('Your previous submission is still waiting for review.', 'review_pending');
      }
      if (latest?.status === 'approved') throw conflict('Your assignment has already been approved.', 'already_approved');
      // Flag (not block) work identical to another learner's, for the reviewer to judge.
      const duplicateConditions = [
        ...(contentHash ? [eq(submissions.contentHash, contentHash)] : []),
        ...(linkUrl ? [eq(submissions.linkUrl, linkUrl)] : []),
      ];
      const [duplicate] = duplicateConditions.length
        ? await tx
            .select({ id: submissions.id })
            .from(submissions)
            .where(and(eq(submissions.courseId, course.id), ne(submissions.userId, user.id), or(...duplicateConditions)))
            .orderBy(asc(submissions.createdAt))
            .limit(1)
        : [];
      const [row] = await tx
        .insert(submissions)
        .values({
          enrollmentId: enrollment.id,
          userId: user.id,
          courseId: course.id,
          communityId: community.id,
          versionId: enrollment.versionId,
          assignmentId: assignment.id,
          attemptNumber: (latest?.attemptNumber ?? 0) + 1,
          text,
          linkUrl,
          mediaId: body.mediaId,
          contentHash,
          duplicateOfId: duplicate?.id ?? null,
        })
        .returning();
      await tx.update(enrollments).set({ lastActivityAt: new Date() }).where(eq(enrollments.id, enrollment.id));
      await audit(tx, {
        action: 'submission.create',
        actorId: user.id,
        communityId: community.id,
        targetType: 'submission',
        targetId: row!.id,
        metadata: { attemptNumber: row!.attemptNumber, duplicateOf: duplicate?.id ?? null },
        ip: req.ip,
      });
      return row!;
    });
    return { submission: { id: submission.id, status: submission.status, attemptNumber: submission.attemptNumber } };
  });

  app.post<{ Params: { id: string } }>('/submissions/:id/appeal', async (req) => {
    const user = requireUser(req);
    const { reason } = parse(z.object({ reason: z.string().trim().min(20, 'Explain your appeal in at least 20 characters').max(4000) }), req.body);
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw notFound('Submission');
    const [submission] = await ctx.db
      .select()
      .from(submissions)
      .where(and(eq(submissions.id, req.params.id), eq(submissions.userId, user.id)));
    if (!submission) throw notFound('Submission');
    if (submission.status !== 'revision_required') throw conflict('Only submissions that were sent back can be appealed.', 'not_appealable');
    const [newer] = await ctx.db
      .select({ id: submissions.id })
      .from(submissions)
      .where(and(eq(submissions.enrollmentId, submission.enrollmentId), sql`${submissions.attemptNumber} > ${submission.attemptNumber}`))
      .limit(1);
    if (newer) throw conflict('You have already resubmitted. Appeal the latest decision instead.', 'superseded');
    const appeal = await ctx.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(appeals)
        .values({ submissionId: submission.id, userId: user.id, communityId: submission.communityId, reason })
        .onConflictDoNothing()
        .returning();
      if (!row) throw conflict('You have already appealed this decision.', 'already_appealed');
      await audit(tx, {
        action: 'appeal.create',
        actorId: user.id,
        communityId: submission.communityId,
        targetType: 'submission',
        targetId: submission.id,
        ip: req.ip,
      });
      return row;
    });
    return { appeal: { id: appeal.id, status: appeal.status } };
  });
}
