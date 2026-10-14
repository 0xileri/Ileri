import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context';
import { appeals, courses, courseVersions, reviews, submissions, users, type RubricScore } from '../db/schema';
import { audit } from '../lib/audit';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { isUuid } from '../lib/misc';
import { parse } from '../lib/validate';
import { evaluateCompletion } from '../learning/completion';
import { signedMediaUrl } from '../media/sign';
import { activeMembership, isStaffRole, loadCommunity, requireCommunityRole, requireUser } from '../permissions';

async function loadSubmission(ctx: AppContext, id: string) {
  if (!isUuid(id)) throw notFound('Submission');
  const [row] = await ctx.db.select().from(submissions).where(eq(submissions.id, id));
  if (!row) throw notFound('Submission');
  return row;
}

const reviewBody = z.object({
  decision: z.enum(['approved', 'revision_required']),
  rubric: z
    .array(z.object({ criterionId: z.string().max(64), met: z.boolean(), note: z.string().trim().max(2000).optional() }))
    .max(30),
  comment: z.string().trim().max(5000).default(''),
});

export async function reviewRoutes(app: FastifyInstance) {
  const { ctx } = app;

  app.get<{ Params: { id: string }; Querystring: { status?: string } }>('/communities/:id/review-queue', async (req) => {
    const community = await loadCommunity(ctx.db, req.params.id);
    await requireCommunityRole(ctx, req, community, 'instructor');
    const open = req.query.status !== 'decided';
    const reviewer = sql<string | null>`(select display_name from users r where r.id = ${submissions.reviewerId})`;
    const rows = await ctx.db
      .select({
        id: submissions.id,
        status: submissions.status,
        attemptNumber: submissions.attemptNumber,
        createdAt: submissions.createdAt,
        claimedAt: submissions.claimedAt,
        decidedAt: submissions.decidedAt,
        duplicateOfId: submissions.duplicateOfId,
        learnerName: users.displayName,
        learnerId: users.id,
        courseId: courses.id,
        courseTitle: courses.title,
        reviewerId: submissions.reviewerId,
        reviewerName: reviewer,
      })
      .from(submissions)
      .innerJoin(users, eq(users.id, submissions.userId))
      .innerJoin(courses, eq(courses.id, submissions.courseId))
      .where(
        and(
          eq(submissions.communityId, community.id),
          open
            ? inArray(submissions.status, ['submitted', 'under_review'])
            : inArray(submissions.status, ['approved', 'revision_required']),
        ),
      )
      .orderBy(open ? asc(submissions.createdAt) : desc(submissions.decidedAt))
      .limit(200);
    const ids = rows.map((r) => r.id);
    const openAppeals = ids.length
      ? await ctx.db.select({ submissionId: appeals.submissionId, status: appeals.status }).from(appeals).where(inArray(appeals.submissionId, ids))
      : [];
    return {
      submissions: rows.map((r) => ({ ...r, appealStatus: openAppeals.find((a) => a.submissionId === r.id)?.status ?? null })),
    };
  });

  app.get<{ Params: { id: string } }>('/submissions/:id', async (req) => {
    const user = requireUser(req);
    const submission = await loadSubmission(ctx, req.params.id);
    const community = await loadCommunity(ctx.db, submission.communityId);
    const membership = await activeMembership(ctx.db, community.id, user.id);
    const staff = user.isPlatformAdmin || isStaffRole(membership?.role);
    if (!staff && submission.userId !== user.id) throw notFound('Submission');
    const [version] = await ctx.db.select().from(courseVersions).where(eq(courseVersions.id, submission.versionId));
    const [course] = await ctx.db.select({ id: courses.id, title: courses.title }).from(courses).where(eq(courses.id, submission.courseId));
    const [learner] = await ctx.db.select({ id: users.id, displayName: users.displayName }).from(users).where(eq(users.id, submission.userId));
    const history = await ctx.db
      .select()
      .from(submissions)
      .where(eq(submissions.enrollmentId, submission.enrollmentId))
      .orderBy(desc(submissions.attemptNumber));
    const reviewRows = await ctx.db
      .select({ review: reviews, reviewerName: users.displayName })
      .from(reviews)
      .innerJoin(users, eq(users.id, reviews.reviewerId))
      .where(inArray(reviews.submissionId, history.map((h) => h.id)))
      .orderBy(asc(reviews.createdAt));
    const [appeal] = await ctx.db.select().from(appeals).where(eq(appeals.submissionId, submission.id));
    let duplicate: { id: string; learnerName: string; createdAt: Date } | null = null;
    if (staff && submission.duplicateOfId) {
      const [dup] = await ctx.db
        .select({ id: submissions.id, learnerName: users.displayName, createdAt: submissions.createdAt })
        .from(submissions)
        .innerJoin(users, eq(users.id, submissions.userId))
        .where(eq(submissions.id, submission.duplicateOfId));
      duplicate = dup ?? null;
    }
    return {
      viewerIsStaff: staff,
      viewerIsLearner: submission.userId === user.id,
      course: course!,
      community: { id: community.id, slug: community.slug, name: community.name },
      learner: learner!,
      assignment: version!.content.assignment,
      versionNumber: version!.versionNumber,
      submission: {
        ...submission,
        contentHash: undefined,
        file: submission.mediaId ? { url: signedMediaUrl(ctx, submission.mediaId) } : null,
      },
      history: history.map((h) => ({
        id: h.id,
        attemptNumber: h.attemptNumber,
        status: h.status,
        text: h.text,
        linkUrl: h.linkUrl,
        file: h.mediaId ? { url: signedMediaUrl(ctx, h.mediaId) } : null,
        createdAt: h.createdAt,
        decidedAt: h.decidedAt,
        reviews: reviewRows
          .filter((r) => r.review.submissionId === h.id)
          .map((r) => ({ ...r.review, reviewerName: r.reviewerName })),
      })),
      appeal: appeal ?? null,
      duplicate,
    };
  });

  app.post<{ Params: { id: string } }>('/submissions/:id/claim', async (req) => {
    const submission = await loadSubmission(ctx, req.params.id);
    const community = await loadCommunity(ctx.db, submission.communityId);
    const actor = await requireCommunityRole(ctx, req, community, 'instructor');
    if (submission.userId === actor.user.id) throw forbidden('You cannot review your own work.');
    const updated = await ctx.db
      .update(submissions)
      .set({ status: 'under_review', reviewerId: actor.user.id, claimedAt: new Date() })
      .where(and(eq(submissions.id, submission.id), eq(submissions.status, 'submitted')))
      .returning({ id: submissions.id });
    if (!updated.length && !(submission.status === 'under_review' && submission.reviewerId === actor.user.id)) {
      throw conflict('Someone else is already reviewing this submission, or it has been decided.', 'already_claimed');
    }
    await audit(ctx.db, {
      action: 'submission.claim',
      actorId: actor.user.id,
      communityId: community.id,
      targetType: 'submission',
      targetId: submission.id,
      ip: req.ip,
    });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/submissions/:id/review', async (req) => {
    const submission = await loadSubmission(ctx, req.params.id);
    const community = await loadCommunity(ctx.db, submission.communityId);
    const actor = await requireCommunityRole(ctx, req, community, 'instructor');
    if (submission.userId === actor.user.id) throw forbidden('You cannot review your own work.');
    const body = parse(reviewBody, req.body);
    const [version] = await ctx.db.select().from(courseVersions).where(eq(courseVersions.id, submission.versionId));
    const rubric = version!.content.assignment?.rubric ?? [];
    const scores = new Map(body.rubric.map((r) => [r.criterionId, r]));
    const missing = rubric.filter((c) => !scores.has(c.id));
    if (missing.length) throw badRequest(`Score every rubric criterion. Missing: ${missing.map((m) => m.title).join(', ')}.`);
    if (body.rubric.some((r) => !rubric.some((c) => c.id === r.criterionId))) throw badRequest('Unknown rubric criterion.');
    const unmetRequired = rubric.filter((c) => c.required && !scores.get(c.id)!.met);
    if (body.decision === 'approved' && unmetRequired.length) {
      throw badRequest(`Approval needs every required criterion met. Not met: ${unmetRequired.map((c) => c.title).join(', ')}.`);
    }
    if (body.decision === 'revision_required' && !body.comment) {
      throw badRequest('Tell the learner what to change when asking for a revision.');
    }
    const rubricScores: RubricScore[] = rubric.map((c) => {
      const s = scores.get(c.id)!;
      return { criterionId: c.id, met: s.met, ...(s.note ? { note: s.note } : {}) };
    });

    const outcome = await ctx.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(submissions).where(eq(submissions.id, submission.id)).for('update');
      if (!locked || (locked.status !== 'submitted' && locked.status !== 'under_review')) {
        throw conflict('This submission has already been decided.', 'already_decided');
      }
      const now = new Date();
      await tx.insert(reviews).values({
        submissionId: submission.id,
        reviewerId: actor.user.id,
        decision: body.decision,
        rubric: rubricScores,
        comment: body.comment,
      });
      await tx
        .update(submissions)
        .set({ status: body.decision, reviewerId: actor.user.id, decidedAt: now, claimedAt: locked.claimedAt ?? now })
        .where(eq(submissions.id, submission.id));
      await audit(tx, {
        action: 'submission.review',
        actorId: actor.user.id,
        communityId: community.id,
        targetType: 'submission',
        targetId: submission.id,
        metadata: { decision: body.decision, learnerId: submission.userId, unmet: rubricScores.filter((r) => !r.met).map((r) => r.criterionId) },
        ip: req.ip,
      });
      return body.decision === 'approved'
        ? evaluateCompletion(tx, submission.enrollmentId, { id: actor.user.id, ip: req.ip })
        : null;
    });
    return { ok: true, courseCompleted: outcome?.completed ?? false };
  });

  // --- Appeals -----------------------------------------------------------------

  app.get<{ Params: { id: string }; Querystring: { status?: string } }>('/communities/:id/appeals', async (req) => {
    const community = await loadCommunity(ctx.db, req.params.id);
    await requireCommunityRole(ctx, req, community, 'owner');
    return { appeals: await listAppeals(ctx, community.id, req.query.status === 'all') };
  });

  app.post<{ Params: { id: string } }>('/appeals/:id/resolve', async (req) => {
    const user = requireUser(req);
    if (!isUuid(req.params.id)) throw notFound('Appeal');
    const body = parse(
      z.object({ outcome: z.enum(['upheld', 'overturned']), note: z.string().trim().min(1, 'Explain the decision').max(4000) }),
      req.body,
    );
    const [appeal] = await ctx.db.select().from(appeals).where(eq(appeals.id, req.params.id));
    if (!appeal) throw notFound('Appeal');
    const community = await loadCommunity(ctx.db, appeal.communityId);
    const actor = await requireCommunityRole(ctx, req, community, 'owner');
    const submission = await loadSubmission(ctx, appeal.submissionId);
    if (actor.role !== 'admin' && submission.reviewerId === user.id) {
      throw forbidden('The original reviewer cannot resolve an appeal of their own decision. Ask another owner.');
    }
    if (submission.userId === user.id) throw forbidden('You cannot resolve your own appeal.');

    const result = await ctx.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(appeals).where(eq(appeals.id, appeal.id)).for('update');
      if (!locked || locked.status !== 'open') throw conflict('This appeal has already been resolved.', 'already_resolved');
      await tx
        .update(appeals)
        .set({ status: body.outcome, resolutionNote: body.note, resolvedBy: user.id, resolvedAt: new Date() })
        .where(eq(appeals.id, appeal.id));
      let completed = false;
      if (body.outcome === 'overturned') {
        const [sub] = await tx.select().from(submissions).where(eq(submissions.id, submission.id)).for('update');
        if (sub!.status !== 'revision_required') throw new AppError(409, 'not_overturnable', 'The submission is no longer in a state that can be overturned.');
        const [version] = await tx.select().from(courseVersions).where(eq(courseVersions.id, sub!.versionId));
        await tx.insert(reviews).values({
          submissionId: sub!.id,
          reviewerId: user.id,
          decision: 'approved',
          rubric: (version!.content.assignment?.rubric ?? []).map((c) => ({ criterionId: c.id, met: true })),
          comment: `Approved on appeal: ${body.note}`,
          viaAppeal: true,
        });
        await tx.update(submissions).set({ status: 'approved', decidedAt: new Date() }).where(eq(submissions.id, sub!.id));
        completed = (await evaluateCompletion(tx, sub!.enrollmentId, { id: user.id, ip: req.ip })).completed;
      }
      await audit(tx, {
        action: 'appeal.resolve',
        actorId: user.id,
        communityId: community.id,
        targetType: 'appeal',
        targetId: appeal.id,
        metadata: { outcome: body.outcome, submissionId: submission.id, learnerId: submission.userId },
        ip: req.ip,
      });
      return { completed };
    });
    return { ok: true, courseCompleted: result.completed };
  });
}

export async function listAppeals(ctx: AppContext, communityId: string | null, includeResolved: boolean) {
  const filters = [];
  if (communityId) filters.push(eq(appeals.communityId, communityId));
  if (!includeResolved) filters.push(eq(appeals.status, 'open'));
  const rows = await ctx.db
    .select({
      id: appeals.id,
      status: appeals.status,
      reason: appeals.reason,
      resolutionNote: appeals.resolutionNote,
      createdAt: appeals.createdAt,
      resolvedAt: appeals.resolvedAt,
      submissionId: appeals.submissionId,
      communityId: appeals.communityId,
      learnerName: users.displayName,
      courseTitle: courses.title,
      reviewerId: submissions.reviewerId,
    })
    .from(appeals)
    .innerJoin(submissions, eq(submissions.id, appeals.submissionId))
    .innerJoin(users, eq(users.id, appeals.userId))
    .innerJoin(courses, eq(courses.id, submissions.courseId))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(asc(appeals.createdAt))
    .limit(200);
  return rows;
}
