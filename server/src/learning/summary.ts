import { and, desc, eq, inArray } from 'drizzle-orm';
import { allLessons, type CourseContent } from '../../../shared/src/content';
import type { Db } from '../db';
import { completions, courseVersions, enrollments, lessonProgress, quizAttempts, submissions } from '../db/schema';

export type Stage =
  | 'enrolled'
  | 'learning'
  | 'submitted'
  | 'under_review'
  | 'revision_required'
  | 'approved'
  | 'completed';

export interface ProgressState {
  completedLessonIds: Set<string>;
  quizPassed: boolean;
  latestSubmissionStatus: 'submitted' | 'under_review' | 'approved' | 'revision_required' | null;
  hasQuizAttempt: boolean;
  completed: boolean;
}

export function computeStage(state: ProgressState): Stage {
  if (state.completed) return 'completed';
  switch (state.latestSubmissionStatus) {
    case 'approved':
      return 'approved';
    case 'under_review':
      return 'under_review';
    case 'submitted':
      return 'submitted';
    case 'revision_required':
      return 'revision_required';
    default:
      return state.completedLessonIds.size > 0 || state.hasQuizAttempt ? 'learning' : 'enrolled';
  }
}

export function computeProgress(content: CourseContent, state: ProgressState) {
  const required = allLessons(content).filter((l) => l.required);
  const lessonsDone = required.filter((l) => state.completedLessonIds.has(l.id)).length;
  let total = content.completion.requireAllLessons ? required.length : 0;
  let done = content.completion.requireAllLessons ? lessonsDone : 0;
  if (content.completion.requireQuiz && content.quiz) {
    total += 1;
    if (state.quizPassed) done += 1;
  }
  if (content.completion.requireAssignment && content.assignment) {
    total += 1;
    if (state.latestSubmissionStatus === 'approved') done += 1;
  }
  const percent = state.completed ? 100 : total === 0 ? 0 : Math.floor((done / total) * 100);
  return { percent, lessonsDone, lessonsTotal: required.length };
}

export interface EnrollmentSummary {
  enrollmentId: string;
  courseId: string;
  versionId: string;
  stage: Stage;
  progressPercent: number;
  lessonsDone: number;
  lessonsTotal: number;
  lastLessonId: string | null;
  enrolledAt: Date;
  lastActivityAt: Date;
  completedAt: Date | null;
}

/** Batch-computes learner progress for several enrollments of one user. */
export async function enrollmentSummaries(
  db: Db,
  userId: string,
  courseIds?: string[],
): Promise<Map<string, EnrollmentSummary>> {
  const result = new Map<string, EnrollmentSummary>();
  if (courseIds && courseIds.length === 0) return result;
  const rows = await db
    .select()
    .from(enrollments)
    .where(
      courseIds
        ? and(eq(enrollments.userId, userId), inArray(enrollments.courseId, courseIds))
        : eq(enrollments.userId, userId),
    );
  if (rows.length === 0) return result;
  const enrollmentIds = rows.map((r) => r.id);
  const versionIds = [...new Set(rows.map((r) => r.versionId))];
  const [versions, progress, latestSubs, passes, attempts, done] = await Promise.all([
    db.select({ id: courseVersions.id, content: courseVersions.content }).from(courseVersions).where(inArray(courseVersions.id, versionIds)),
    db.select().from(lessonProgress).where(inArray(lessonProgress.enrollmentId, enrollmentIds)),
    db
      .selectDistinctOn([submissions.enrollmentId], { enrollmentId: submissions.enrollmentId, status: submissions.status })
      .from(submissions)
      .where(inArray(submissions.enrollmentId, enrollmentIds))
      .orderBy(submissions.enrollmentId, desc(submissions.attemptNumber)),
    db
      .selectDistinct({ enrollmentId: quizAttempts.enrollmentId })
      .from(quizAttempts)
      .where(and(inArray(quizAttempts.enrollmentId, enrollmentIds), eq(quizAttempts.passed, true))),
    db
      .selectDistinct({ enrollmentId: quizAttempts.enrollmentId })
      .from(quizAttempts)
      .where(inArray(quizAttempts.enrollmentId, enrollmentIds)),
    db
      .select({ courseId: completions.courseId })
      .from(completions)
      .where(and(eq(completions.userId, userId), eq(completions.status, 'valid'))),
  ]);
  const contentBy = new Map(versions.map((v) => [v.id, v.content]));
  const passed = new Set(passes.map((p) => p.enrollmentId));
  const attempted = new Set(attempts.map((p) => p.enrollmentId));
  const completedCourses = new Set(done.map((d) => d.courseId));
  const subBy = new Map(latestSubs.map((s) => [s.enrollmentId, s.status]));
  for (const row of rows) {
    const state: ProgressState = {
      completedLessonIds: new Set(progress.filter((p) => p.enrollmentId === row.id).map((p) => p.lessonId)),
      quizPassed: passed.has(row.id),
      hasQuizAttempt: attempted.has(row.id),
      latestSubmissionStatus: subBy.get(row.id) ?? null,
      completed: completedCourses.has(row.courseId),
    };
    const content = contentBy.get(row.versionId)!;
    const p = computeProgress(content, state);
    result.set(row.courseId, {
      enrollmentId: row.id,
      courseId: row.courseId,
      versionId: row.versionId,
      stage: computeStage(state),
      progressPercent: p.percent,
      lessonsDone: p.lessonsDone,
      lessonsTotal: p.lessonsTotal,
      lastLessonId: row.lastLessonId,
      enrolledAt: row.createdAt,
      lastActivityAt: row.lastActivityAt,
      completedAt: row.completedAt,
    });
  }
  return result;
}
