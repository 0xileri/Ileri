import { and, desc, eq, lt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { auditEvents, users } from '../db/schema';
import { loadCommunity, requireCommunityRole } from '../permissions';

type Row = Record<string, unknown>;

export async function analyticsRoutes(app: FastifyInstance) {
  const { ctx } = app;

  app.get<{ Params: { id: string } }>('/communities/:id/analytics', async (req) => {
    const community = await loadCommunity(ctx.db, req.params.id);
    await requireCommunityRole(ctx, req, community, 'instructor');
    const cid = community.id;
    const many = async (query: ReturnType<typeof sql>) =>
      ((await ctx.db.execute(query)) as unknown as { rows: Row[] }).rows;
    const one = async (query: ReturnType<typeof sql>) => (await many(query))[0] ?? {};

    const [people, learning, quiz, review, rewards, appealsRow, creds, perCourse, weekly] = await Promise.all([
      one(sql`
        select
          (select count(*) from memberships where community_id = ${cid} and status = 'active')::int as members,
          (select count(distinct user_id) from enrollments where community_id = ${cid})::int as learners,
          (select count(*) from (
             select user_id from enrollments where community_id = ${cid} group by user_id having count(*) > 1
           ) r)::int as returning_learners`),
      one(sql`
        select
          (select count(*) from enrollments where community_id = ${cid})::int as enrollments,
          (select count(*) from completions where community_id = ${cid} and status = 'valid')::int as completions,
          (select count(*) from enrollments where community_id = ${cid} and created_at > now() - interval '30 days')::int as enrollments_30d,
          (select count(*) from completions where community_id = ${cid} and status = 'valid' and completed_at > now() - interval '30 days')::int as completions_30d`),
      one(sql`
        select count(*)::int as attempts,
               count(*) filter (where qa.passed)::int as passed,
               coalesce(round(avg(qa.score_percent)), 0)::int as avg_score
        from quiz_attempts qa join courses c on c.id = qa.course_id
        where c.community_id = ${cid} and qa.submitted_at is not null`),
      one(sql`
        select
          count(*) filter (where status in ('submitted', 'under_review'))::int as open,
          count(*) filter (where status = 'approved')::int as approved,
          count(*) filter (where status = 'revision_required')::int as revision_required,
          coalesce(round(extract(epoch from avg(decided_at - created_at) filter (where decided_at is not null)) / 3600, 1), 0)::float as avg_review_hours,
          coalesce(round(extract(epoch from (now() - min(created_at) filter (where status in ('submitted', 'under_review')))) / 3600, 1), 0)::float as oldest_open_hours,
          count(*) filter (where duplicate_of_id is not null)::int as flagged_duplicates
        from submissions where community_id = ${cid}`),
      many(sql`
        select rc.reward_kind as kind,
               coalesce(sum(re.amount) filter (where re.status = 'confirmed'), 0)::int as paid,
               coalesce(sum(re.amount) filter (where re.status in ('eligible', 'submitted', 'reserved')), 0)::int as committed,
               count(*) filter (where re.status = 'confirmed')::int as paid_count,
               count(*) filter (where re.status = 'unfunded')::int as unfunded_count,
               count(*) filter (where re.status = 'rejected')::int as rejected_count
        from reward_campaigns rc left join reward_entitlements re on re.campaign_id = rc.id
        where rc.community_id = ${cid}
        group by rc.reward_kind`),
      one(sql`
        select count(*) filter (where status = 'open')::int as open,
               count(*) filter (where status = 'upheld')::int as upheld,
               count(*) filter (where status = 'overturned')::int as overturned
        from appeals where community_id = ${cid}`),
      one(sql`
        select count(*) filter (where status = 'active')::int as active,
               count(*) filter (where status = 'revoked')::int as revoked
        from credentials where community_id = ${cid}`),
      many(sql`
        select c.id, c.title, c.status,
          (select count(*) from enrollments e where e.course_id = c.id)::int as enrollments,
          (select count(*) from completions m where m.course_id = c.id and m.status = 'valid')::int as completions,
          (select coalesce(round(avg(extract(epoch from (m.completed_at - e.created_at)) / 86400)::numeric, 1), 0)
             from completions m join enrollments e on e.id = m.enrollment_id
             where m.course_id = c.id and m.status = 'valid')::float as avg_days_to_complete,
          (select coalesce(round(avg(qa.score_percent)), 0) from quiz_attempts qa where qa.course_id = c.id and qa.submitted_at is not null)::int as avg_quiz_score
        from courses c where c.community_id = ${cid}
        order by c.created_at`),
      many(sql`
        with weeks as (
          select generate_series(date_trunc('week', now()) - interval '7 weeks', date_trunc('week', now()), interval '1 week') as week
        )
        select to_char(w.week, 'YYYY-MM-DD') as week,
          (select count(*) from enrollments e where e.community_id = ${cid} and date_trunc('week', e.created_at) = w.week)::int as enrollments,
          (select count(*) from completions m where m.community_id = ${cid} and m.status = 'valid' and date_trunc('week', m.completed_at) = w.week)::int as completions
        from weeks w order by w.week`),
    ]);

    const n = (v: unknown) => Number(v ?? 0);
    const members = n(people.members);
    const enrollments = n(learning.enrollments);
    const completions = n(learning.completions);
    const pointsRow = rewards.find((r) => r.kind === 'points');
    const creditsRow = rewards.find((r) => r.kind === 'course_credits');
    return {
      summary: {
        members,
        learners: n(people.learners),
        memberEnrollmentRate: members ? Math.round((n(people.learners) / members) * 100) : 0,
        returningLearners: n(people.returning_learners),
        enrollments,
        completions,
        completionRate: enrollments ? Math.round((completions / enrollments) * 100) : 0,
        enrollments30d: n(learning.enrollments_30d),
        completions30d: n(learning.completions_30d),
      },
      assessments: {
        quizAttempts: n(quiz.attempts),
        quizPassRate: n(quiz.attempts) ? Math.round((n(quiz.passed) / n(quiz.attempts)) * 100) : 0,
        averageQuizScore: n(quiz.avg_score),
        submissionsApproved: n(review.approved),
        submissionsSentBack: n(review.revision_required),
        flaggedDuplicates: n(review.flagged_duplicates),
      },
      reviews: {
        open: n(review.open),
        averageReviewHours: n(review.avg_review_hours),
        oldestOpenHours: n(review.oldest_open_hours),
      },
      rewards: {
        pointsPaid: n(pointsRow?.paid),
        creditsPaid: n(creditsRow?.paid),
        committed: n(pointsRow?.committed) + n(creditsRow?.committed),
        unfunded: n(pointsRow?.unfunded_count) + n(creditsRow?.unfunded_count),
        rejected: n(pointsRow?.rejected_count) + n(creditsRow?.rejected_count),
        costPerCompletion: {
          points: completions ? Math.round((n(pointsRow?.paid) / completions) * 10) / 10 : 0,
          courseCredits: completions ? Math.round((n(creditsRow?.paid) / completions) * 10) / 10 : 0,
        },
      },
      integrity: {
        appealsOpen: n(appealsRow.open),
        appealsUpheld: n(appealsRow.upheld),
        appealsOverturned: n(appealsRow.overturned),
        credentialsActive: n(creds.active),
        credentialsRevoked: n(creds.revoked),
      },
      courses: perCourse.map((c) => ({
        id: String(c.id),
        title: String(c.title),
        status: String(c.status),
        enrollments: n(c.enrollments),
        completions: n(c.completions),
        completionRate: n(c.enrollments) ? Math.round((n(c.completions) / n(c.enrollments)) * 100) : 0,
        avgDaysToComplete: n(c.avg_days_to_complete),
        avgQuizScore: n(c.avg_quiz_score),
      })),
      weekly: weekly.map((w) => ({ week: String(w.week), enrollments: n(w.enrollments), completions: n(w.completions) })),
    };
  });

  app.get<{ Params: { id: string }; Querystring: { before?: string; action?: string } }>('/communities/:id/audit', async (req) => {
    const community = await loadCommunity(ctx.db, req.params.id);
    await requireCommunityRole(ctx, req, community, 'owner');
    return { events: await auditPage(app, community.id, req.query) };
  });
}

export async function auditPage(app: FastifyInstance, communityId: string | null, query: { before?: string; action?: string }) {
  const filters = [];
  if (communityId) filters.push(eq(auditEvents.communityId, communityId));
  const before = Number.parseInt(query.before ?? '', 10);
  if (Number.isFinite(before)) filters.push(lt(auditEvents.id, before));
  if (query.action && /^[a-z_.]{1,60}$/.test(query.action)) {
    filters.push(sql`${auditEvents.action} like ${`${query.action}%`}`);
  }
  return app.ctx.db
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      targetType: auditEvents.targetType,
      targetId: auditEvents.targetId,
      metadata: auditEvents.metadata,
      createdAt: auditEvents.createdAt,
      communityId: auditEvents.communityId,
      actorId: auditEvents.actorId,
      actorName: users.displayName,
      ip: auditEvents.ip,
    })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorId))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(auditEvents.id))
    .limit(100);
}
