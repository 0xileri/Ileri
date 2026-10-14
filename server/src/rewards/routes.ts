import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { communities, courses, ledgerEntries, memberships, rewardCampaigns, rewardEntitlements, users } from '../db/schema';
import { audit } from '../lib/audit';
import { badRequest, conflict, notFound } from '../lib/errors';
import { isUuid } from '../lib/misc';
import { parse } from '../lib/validate';
import { loadCommunity, requireCommunityRole, requireUser } from '../permissions';
import { campaignPublicView, claimReward, decideClaim, postLedger } from './service';

const dateish = z.coerce.date();

const campaignBody = z
  .object({
    courseId: z.uuid(),
    name: z.string().trim().min(2).max(120),
    rewardKind: z.enum(['points', 'course_credits']),
    amountPerCompletion: z.number().int().min(1).max(1_000_000),
    maxRewards: z.number().int().min(1).max(1_000_000).nullable().default(null),
    totalBudget: z.number().int().min(1).max(1_000_000_000).nullable().default(null),
    allocationMode: z.enum(['first_approved', 'reserved_at_enrollment']).default('first_approved'),
    requiresApproval: z.boolean().default(false),
    startsAt: dateish.default(() => new Date()),
    endsAt: dateish.nullable().default(null),
    claimDeadline: dateish.nullable().default(null),
    activate: z.boolean().default(false),
  })
  .refine((b) => !b.endsAt || b.endsAt > b.startsAt, { message: 'End date must be after the start date', path: ['endsAt'] })
  .refine((b) => !b.claimDeadline || !b.endsAt || b.claimDeadline >= b.endsAt, {
    message: 'Claim deadline cannot be before the campaign ends',
    path: ['claimDeadline'],
  })
  .refine((b) => b.allocationMode !== 'reserved_at_enrollment' || b.maxRewards !== null || b.totalBudget !== null, {
    message: 'Guaranteed-at-enrollment campaigns need a cap so reservations cannot exceed the budget',
    path: ['maxRewards'],
  });

const campaignPatch = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  maxRewards: z.number().int().min(1).max(1_000_000).nullable().optional(),
  totalBudget: z.number().int().min(1).max(1_000_000_000).nullable().optional(),
  requiresApproval: z.boolean().optional(),
  endsAt: dateish.nullable().optional(),
  claimDeadline: dateish.nullable().optional(),
});

export async function rewardRoutes(app: FastifyInstance) {
  const { ctx } = app;

  async function loadCampaign(id: string) {
    if (!isUuid(id)) throw notFound('Campaign');
    const [row] = await ctx.db.select().from(rewardCampaigns).where(eq(rewardCampaigns.id, id));
    if (!row) throw notFound('Campaign');
    return row;
  }

  app.get<{ Params: { id: string } }>('/communities/:id/campaigns', async (req) => {
    const community = await loadCommunity(ctx.db, req.params.id);
    await requireCommunityRole(ctx, req, community, 'instructor');
    const rows = await ctx.db
      .select({ campaign: rewardCampaigns, courseTitle: courses.title })
      .from(rewardCampaigns)
      .innerJoin(courses, eq(courses.id, rewardCampaigns.courseId))
      .where(eq(rewardCampaigns.communityId, community.id))
      .orderBy(desc(rewardCampaigns.createdAt));
    const ids = rows.map((r) => r.campaign.id);
    const statusCounts = ids.length
      ? await ctx.db
          .select({ campaignId: rewardEntitlements.campaignId, status: rewardEntitlements.status, n: count(), amount: sql<number>`coalesce(sum(${rewardEntitlements.amount}),0)::int` })
          .from(rewardEntitlements)
          .where(inArray(rewardEntitlements.campaignId, ids))
          .groupBy(rewardEntitlements.campaignId, rewardEntitlements.status)
      : [];
    return {
      campaigns: rows.map(({ campaign, courseTitle }) => {
        const counts = Object.fromEntries(
          statusCounts.filter((s) => s.campaignId === campaign.id).map((s) => [s.status, { count: s.n, amount: s.amount }]),
        );
        return {
          ...campaignPublicView(campaign),
          courseTitle,
          totalBudget: campaign.totalBudget,
          allocatedCount: campaign.allocatedCount,
          allocatedAmount: campaign.allocatedAmount,
          paidAmount: counts.confirmed?.amount ?? 0,
          counts,
          createdAt: campaign.createdAt,
        };
      }),
    };
  });

  app.post<{ Params: { id: string } }>('/communities/:id/campaigns', async (req) => {
    const community = await loadCommunity(ctx.db, req.params.id);
    const actor = await requireCommunityRole(ctx, req, community, 'owner');
    const body = parse(campaignBody, req.body);
    const [course] = await ctx.db
      .select({ id: courses.id })
      .from(courses)
      .where(and(eq(courses.id, body.courseId), eq(courses.communityId, community.id)));
    if (!course) throw badRequest('Choose a course from this community.');
    const { activate, ...values } = body;
    const campaign = await ctx.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(rewardCampaigns)
        .values({ ...values, communityId: community.id, createdBy: actor.user.id, status: activate ? 'active' : 'draft' })
        .returning();
      await audit(tx, {
        action: 'campaign.create',
        actorId: actor.user.id,
        communityId: community.id,
        targetType: 'campaign',
        targetId: row!.id,
        metadata: { ...values, status: row!.status },
        ip: req.ip,
      });
      return row!;
    });
    return { campaign: campaignPublicView(campaign) };
  });

  app.patch<{ Params: { id: string } }>('/campaigns/:id', async (req) => {
    const campaign = await loadCampaign(req.params.id);
    const community = await loadCommunity(ctx.db, campaign.communityId);
    const actor = await requireCommunityRole(ctx, req, community, 'owner');
    const body = parse(campaignPatch, req.body);
    if (Object.keys(body).length === 0) throw badRequest('Nothing to update.');
    await ctx.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(rewardCampaigns).where(eq(rewardCampaigns.id, campaign.id)).for('update');
      if (body.maxRewards != null && body.maxRewards < locked!.allocatedCount) {
        throw badRequest(`${locked!.allocatedCount} rewards are already committed. The cap cannot go below that.`);
      }
      if (body.totalBudget != null && body.totalBudget < locked!.allocatedAmount) {
        throw badRequest(`${locked!.allocatedAmount} is already committed. The budget cannot go below that.`);
      }
      const maxRewards = body.maxRewards === undefined ? locked!.maxRewards : body.maxRewards;
      const totalBudget = body.totalBudget === undefined ? locked!.totalBudget : body.totalBudget;
      if (locked!.allocationMode === 'reserved_at_enrollment' && maxRewards === null && totalBudget === null) {
        throw badRequest('Guaranteed-at-enrollment campaigns need a cap.');
      }
      await tx.update(rewardCampaigns).set(body).where(eq(rewardCampaigns.id, campaign.id));
      await audit(tx, {
        action: 'campaign.update',
        actorId: actor.user.id,
        communityId: community.id,
        targetType: 'campaign',
        targetId: campaign.id,
        metadata: body,
        ip: req.ip,
      });
    });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/campaigns/:id/status', async (req) => {
    const campaign = await loadCampaign(req.params.id);
    const community = await loadCommunity(ctx.db, campaign.communityId);
    const actor = await requireCommunityRole(ctx, req, community, 'owner');
    const { status } = parse(z.object({ status: z.enum(['active', 'paused', 'ended']) }), req.body);
    if (campaign.status === 'ended') throw conflict('Ended campaigns cannot be restarted. Create a new one.', 'ended');
    await ctx.db.transaction(async (tx) => {
      await tx.update(rewardCampaigns).set({ status }).where(eq(rewardCampaigns.id, campaign.id));
      await audit(tx, {
        action: 'campaign.status',
        actorId: actor.user.id,
        communityId: community.id,
        targetType: 'campaign',
        targetId: campaign.id,
        metadata: { from: campaign.status, to: status },
        ip: req.ip,
      });
    });
    return { ok: true };
  });

  app.get<{ Params: { id: string }; Querystring: { status?: string } }>('/communities/:id/reward-claims', async (req) => {
    const community = await loadCommunity(ctx.db, req.params.id);
    await requireCommunityRole(ctx, req, community, 'owner');
    const statuses = req.query.status === 'all'
      ? (['eligible', 'submitted', 'confirmed', 'rejected', 'expired', 'unfunded', 'reserved'] as const)
      : (['submitted'] as const);
    const rows = await ctx.db
      .select({
        id: rewardEntitlements.id,
        status: rewardEntitlements.status,
        amount: rewardEntitlements.amount,
        note: rewardEntitlements.note,
        claimedAt: rewardEntitlements.claimedAt,
        eligibleAt: rewardEntitlements.eligibleAt,
        createdAt: rewardEntitlements.createdAt,
        learnerName: users.displayName,
        learnerId: users.id,
        campaignName: rewardCampaigns.name,
        rewardKind: rewardCampaigns.rewardKind,
        courseTitle: courses.title,
      })
      .from(rewardEntitlements)
      .innerJoin(users, eq(users.id, rewardEntitlements.userId))
      .innerJoin(rewardCampaigns, eq(rewardCampaigns.id, rewardEntitlements.campaignId))
      .innerJoin(courses, eq(courses.id, rewardEntitlements.courseId))
      .where(and(eq(rewardEntitlements.communityId, community.id), inArray(rewardEntitlements.status, [...statuses])))
      .orderBy(desc(rewardEntitlements.createdAt))
      .limit(500);
    return { claims: rows };
  });

  app.post<{ Params: { id: string } }>('/reward-claims/:id/decision', async (req) => {
    if (!isUuid(req.params.id)) throw notFound('Reward claim');
    const body = parse(z.object({ decision: z.enum(['approve', 'reject']), note: z.string().trim().max(1000).default('') }), req.body);
    const [entitlement] = await ctx.db.select().from(rewardEntitlements).where(eq(rewardEntitlements.id, req.params.id));
    if (!entitlement) throw notFound('Reward claim');
    const community = await loadCommunity(ctx.db, entitlement.communityId);
    const actor = await requireCommunityRole(ctx, req, community, 'owner');
    if (entitlement.userId === actor.user.id) throw badRequest('You cannot approve your own reward.');
    await ctx.db.transaction((tx) => decideClaim(tx, entitlement.id, community.id, body.decision, actor.user.id, body.note, req.ip));
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/communities/:id/ledger-adjustments', async (req) => {
    const community = await loadCommunity(ctx.db, req.params.id);
    const actor = await requireCommunityRole(ctx, req, community, 'owner');
    const body = parse(
      z.object({
        userId: z.uuid(),
        kind: z.enum(['points', 'course_credits']),
        amount: z.number().int().min(-1_000_000).max(1_000_000).refine((n) => n !== 0, 'Amount cannot be zero'),
        memo: z.string().trim().min(3).max(300),
      }),
      req.body,
    );
    const [member] = await ctx.db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.communityId, community.id), eq(memberships.userId, body.userId)));
    if (!member) throw badRequest('That person is not part of this community.');
    await ctx.db.transaction(async (tx) => {
      const id = crypto.randomUUID();
      await postLedger(tx, {
        userId: body.userId,
        communityId: community.id,
        kind: body.kind,
        amount: body.amount,
        reason: 'adjustment',
        sourceType: 'adjustment',
        sourceId: id,
        memo: body.memo,
        createdBy: actor.user.id,
      });
      await audit(tx, {
        action: 'ledger.adjust',
        actorId: actor.user.id,
        communityId: community.id,
        targetType: 'user',
        targetId: body.userId,
        metadata: { kind: body.kind, amount: body.amount, memo: body.memo },
        ip: req.ip,
      });
    });
    return { ok: true };
  });

  // --- Learner side -------------------------------------------------------------

  app.get('/me/rewards', async (req) => {
    const user = requireUser(req);
    const rows = await ctx.db
      .select({
        id: rewardEntitlements.id,
        status: rewardEntitlements.status,
        amount: rewardEntitlements.amount,
        note: rewardEntitlements.note,
        createdAt: rewardEntitlements.createdAt,
        eligibleAt: rewardEntitlements.eligibleAt,
        claimedAt: rewardEntitlements.claimedAt,
        resolvedAt: rewardEntitlements.resolvedAt,
        campaignName: rewardCampaigns.name,
        rewardKind: rewardCampaigns.rewardKind,
        claimDeadline: rewardCampaigns.claimDeadline,
        requiresApproval: rewardCampaigns.requiresApproval,
        courseId: courses.id,
        courseTitle: courses.title,
        communityName: communities.name,
        communitySlug: communities.slug,
      })
      .from(rewardEntitlements)
      .innerJoin(rewardCampaigns, eq(rewardCampaigns.id, rewardEntitlements.campaignId))
      .innerJoin(courses, eq(courses.id, rewardEntitlements.courseId))
      .innerJoin(communities, eq(communities.id, rewardEntitlements.communityId))
      .where(eq(rewardEntitlements.userId, user.id))
      .orderBy(desc(rewardEntitlements.createdAt));
    const balances = await ctx.db
      .select({
        communityId: ledgerEntries.communityId,
        communityName: communities.name,
        communitySlug: communities.slug,
        kind: ledgerEntries.kind,
        balance: sql<number>`sum(${ledgerEntries.amount})::int`,
      })
      .from(ledgerEntries)
      .innerJoin(communities, eq(communities.id, ledgerEntries.communityId))
      .where(eq(ledgerEntries.userId, user.id))
      .groupBy(ledgerEntries.communityId, communities.name, communities.slug, ledgerEntries.kind);
    const ledger = await ctx.db
      .select({
        id: ledgerEntries.id,
        kind: ledgerEntries.kind,
        amount: ledgerEntries.amount,
        reason: ledgerEntries.reason,
        memo: ledgerEntries.memo,
        createdAt: ledgerEntries.createdAt,
        communityName: communities.name,
      })
      .from(ledgerEntries)
      .innerJoin(communities, eq(communities.id, ledgerEntries.communityId))
      .where(eq(ledgerEntries.userId, user.id))
      .orderBy(desc(ledgerEntries.createdAt))
      .limit(100);
    return { rewards: rows, balances, ledger };
  });

  app.post<{ Params: { id: string } }>('/me/rewards/:id/claim', async (req) => {
    const user = requireUser(req);
    if (!isUuid(req.params.id)) throw notFound('Reward');
    const entitlement = await ctx.db.transaction((tx) => claimReward(tx, req.params.id, user.id, req.ip));
    return { reward: { id: entitlement.id, status: entitlement.status } };
  });
}
