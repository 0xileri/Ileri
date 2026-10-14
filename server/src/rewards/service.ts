import { and, eq, inArray, sql, sum } from 'drizzle-orm';
import type { Db } from '../db';
import { ledgerEntries, rewardCampaigns, rewardEntitlements } from '../db/schema';
import { audit } from '../lib/audit';
import { badRequest, conflict, notFound } from '../lib/errors';

export type Campaign = typeof rewardCampaigns.$inferSelect;
export type Entitlement = typeof rewardEntitlements.$inferSelect;

/** How many more rewards a campaign can fund, or null when uncapped. */
export function remainingRewards(c: Campaign): number | null {
  const limits: number[] = [];
  if (c.maxRewards !== null) limits.push(c.maxRewards - c.allocatedCount);
  if (c.totalBudget !== null) limits.push(Math.floor((c.totalBudget - c.allocatedAmount) / c.amountPerCompletion));
  return limits.length ? Math.max(0, Math.min(...limits)) : null;
}

export function isLive(c: Campaign, at = new Date()): boolean {
  return c.status === 'active' && c.startsAt <= at && (!c.endsAt || c.endsAt > at);
}

export function campaignPublicView(c: Campaign) {
  return {
    id: c.id,
    courseId: c.courseId,
    name: c.name,
    rewardKind: c.rewardKind,
    amountPerCompletion: c.amountPerCompletion,
    allocationMode: c.allocationMode,
    requiresApproval: c.requiresApproval,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    claimDeadline: c.claimDeadline,
    status: c.status,
    live: isLive(c),
    remaining: remainingRewards(c),
    maxRewards: c.maxRewards,
  };
}

export async function liveCampaignsByCourse(db: Db, courseIds: string[]) {
  const map = new Map<string, ReturnType<typeof campaignPublicView>[]>();
  if (courseIds.length === 0) return map;
  const rows = await db
    .select()
    .from(rewardCampaigns)
    .where(and(inArray(rewardCampaigns.courseId, courseIds), eq(rewardCampaigns.status, 'active')));
  for (const row of rows) {
    if (!isLive(row)) continue;
    const list = map.get(row.courseId) ?? [];
    list.push(campaignPublicView(row));
    map.set(row.courseId, list);
  }
  return map;
}

async function lockCampaign(tx: Db, campaignId: string): Promise<Campaign> {
  const [campaign] = await tx.select().from(rewardCampaigns).where(eq(rewardCampaigns.id, campaignId)).for('update');
  if (!campaign) throw notFound('Campaign');
  return campaign;
}

async function commitBudget(tx: Db, campaign: Campaign, delta: 1 | -1): Promise<void> {
  await tx
    .update(rewardCampaigns)
    .set({
      allocatedCount: sql`${rewardCampaigns.allocatedCount} + ${delta}`,
      allocatedAmount: sql`${rewardCampaigns.allocatedAmount} + ${delta * campaign.amountPerCompletion}`,
    })
    .where(eq(rewardCampaigns.id, campaign.id));
}

/**
 * Reserves budget when a learner enrolls in a course whose campaign guarantees
 * rewards at enrollment. Returns null when nothing was reserved.
 */
export async function reserveAtEnrollment(
  tx: Db,
  input: { userId: string; courseId: string; communityId: string; enrollmentId: string },
): Promise<void> {
  const campaigns = await tx
    .select({ id: rewardCampaigns.id })
    .from(rewardCampaigns)
    .where(
      and(
        eq(rewardCampaigns.courseId, input.courseId),
        eq(rewardCampaigns.status, 'active'),
        eq(rewardCampaigns.allocationMode, 'reserved_at_enrollment'),
      ),
    );
  for (const { id } of campaigns) {
    const campaign = await lockCampaign(tx, id);
    if (!isLive(campaign)) continue;
    const remaining = remainingRewards(campaign);
    if (remaining !== null && remaining <= 0) continue;
    const inserted = await tx
      .insert(rewardEntitlements)
      .values({
        campaignId: campaign.id,
        userId: input.userId,
        communityId: input.communityId,
        courseId: input.courseId,
        enrollmentId: input.enrollmentId,
        amount: campaign.amountPerCompletion,
        status: 'reserved',
      })
      .onConflictDoNothing()
      .returning({ id: rewardEntitlements.id });
    if (inserted.length) await commitBudget(tx, campaign, 1);
  }
}

/**
 * Called once when a completion is recorded. Converts reservations to claimable
 * rewards, or allocates from the remaining budget for first-approved campaigns.
 * When the budget is gone the learner gets an "unfunded" record so the outcome
 * is visible instead of silently missing.
 */
export async function allocateOnCompletion(
  tx: Db,
  input: { userId: string; courseId: string; communityId: string; enrollmentId: string; completionId: string },
): Promise<void> {
  const now = new Date();
  const campaigns = await tx
    .select({ id: rewardCampaigns.id })
    .from(rewardCampaigns)
    .where(and(eq(rewardCampaigns.courseId, input.courseId), eq(rewardCampaigns.status, 'active')));
  for (const { id } of campaigns) {
    const campaign = await lockCampaign(tx, id);
    const [existing] = await tx
      .select()
      .from(rewardEntitlements)
      .where(and(eq(rewardEntitlements.campaignId, campaign.id), eq(rewardEntitlements.userId, input.userId)))
      .for('update');
    if (existing) {
      if (existing.status === 'reserved') {
        await tx
          .update(rewardEntitlements)
          .set({ status: 'eligible', completionId: input.completionId, eligibleAt: now })
          .where(eq(rewardEntitlements.id, existing.id));
      }
      continue;
    }
    if (!isLive(campaign, now)) continue;
    const remaining = remainingRewards(campaign);
    const funded = remaining === null || remaining > 0;
    await tx.insert(rewardEntitlements).values({
      campaignId: campaign.id,
      userId: input.userId,
      communityId: input.communityId,
      courseId: input.courseId,
      enrollmentId: input.enrollmentId,
      completionId: input.completionId,
      amount: campaign.amountPerCompletion,
      status: funded ? 'eligible' : 'unfunded',
      eligibleAt: funded ? now : null,
      note: funded ? '' : 'The campaign budget was used up before your completion was approved.',
    });
    if (funded) await commitBudget(tx, campaign, 1);
  }
}

/** Posts a ledger entry exactly once per source. Returns false if it already existed. */
export async function postLedger(
  tx: Db,
  entry: typeof ledgerEntries.$inferInsert,
): Promise<boolean> {
  const inserted = await tx.insert(ledgerEntries).values(entry).onConflictDoNothing().returning({ id: ledgerEntries.id });
  return inserted.length > 0;
}

export async function balanceOf(
  db: Db,
  userId: string,
  communityId: string,
  kind: 'points' | 'course_credits',
): Promise<number> {
  const [row] = await db
    .select({ total: sum(ledgerEntries.amount) })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.userId, userId), eq(ledgerEntries.communityId, communityId), eq(ledgerEntries.kind, kind)));
  return Number(row?.total ?? 0);
}

async function payOut(tx: Db, entitlement: Entitlement, campaign: Campaign, actorId: string): Promise<void> {
  await postLedger(tx, {
    userId: entitlement.userId,
    communityId: entitlement.communityId,
    kind: campaign.rewardKind,
    amount: entitlement.amount,
    reason: 'reward',
    sourceType: 'reward_entitlement',
    sourceId: entitlement.id,
    memo: campaign.name,
    createdBy: actorId,
  });
  await tx
    .update(rewardEntitlements)
    .set({ status: 'confirmed', resolvedAt: new Date() })
    .where(eq(rewardEntitlements.id, entitlement.id));
}

/**
 * Claims a reward. Safe to call repeatedly: the entitlement row is locked, its
 * state machine only moves forward, and the ledger is unique per entitlement.
 */
export async function claimReward(tx: Db, entitlementId: string, userId: string, ip: string): Promise<Entitlement> {
  const [entitlement] = await tx
    .select()
    .from(rewardEntitlements)
    .where(and(eq(rewardEntitlements.id, entitlementId), eq(rewardEntitlements.userId, userId)))
    .for('update');
  if (!entitlement) throw notFound('Reward');
  if (entitlement.status === 'confirmed' || entitlement.status === 'submitted' || entitlement.status === 'pending') {
    return entitlement;
  }
  if (entitlement.status !== 'eligible' && entitlement.status !== 'failed') {
    throw conflict(claimBlockedMessage(entitlement.status), 'not_claimable');
  }
  const [campaign] = await tx.select().from(rewardCampaigns).where(eq(rewardCampaigns.id, entitlement.campaignId));
  if (!campaign) throw notFound('Campaign');
  if (campaign.claimDeadline && campaign.claimDeadline < new Date()) {
    throw conflict('The claim deadline for this reward has passed.', 'claim_expired');
  }
  if (campaign.status === 'paused') throw conflict('This campaign is paused. Try again later.', 'campaign_paused');
  await tx.update(rewardEntitlements).set({ claimedAt: new Date() }).where(eq(rewardEntitlements.id, entitlement.id));
  if (campaign.requiresApproval) {
    await tx.update(rewardEntitlements).set({ status: 'submitted' }).where(eq(rewardEntitlements.id, entitlement.id));
  } else {
    await payOut(tx, entitlement, campaign, userId);
  }
  await audit(tx, {
    action: 'reward.claim',
    actorId: userId,
    communityId: entitlement.communityId,
    targetType: 'reward_entitlement',
    targetId: entitlement.id,
    metadata: { amount: entitlement.amount, kind: campaign.rewardKind, needsApproval: campaign.requiresApproval },
    ip,
  });
  const [updated] = await tx.select().from(rewardEntitlements).where(eq(rewardEntitlements.id, entitlement.id));
  return updated!;
}

export async function decideClaim(
  tx: Db,
  entitlementId: string,
  communityId: string,
  decision: 'approve' | 'reject',
  actorId: string,
  note: string,
  ip: string,
): Promise<void> {
  const [entitlement] = await tx
    .select()
    .from(rewardEntitlements)
    .where(and(eq(rewardEntitlements.id, entitlementId), eq(rewardEntitlements.communityId, communityId)))
    .for('update');
  if (!entitlement) throw notFound('Reward claim');
  if (entitlement.status !== 'submitted') throw conflict('This claim is not waiting for approval.', 'not_pending');
  const campaign = await lockCampaign(tx, entitlement.campaignId);
  if (decision === 'approve') {
    await payOut(tx, entitlement, campaign, actorId);
  } else {
    if (!note.trim()) throw badRequest('Give the learner a reason for rejecting the claim.');
    await tx
      .update(rewardEntitlements)
      .set({ status: 'rejected', note, resolvedAt: new Date() })
      .where(eq(rewardEntitlements.id, entitlement.id));
    await commitBudget(tx, campaign, -1);
  }
  await audit(tx, {
    action: decision === 'approve' ? 'reward.approve' : 'reward.reject',
    actorId,
    communityId,
    targetType: 'reward_entitlement',
    targetId: entitlement.id,
    metadata: { amount: entitlement.amount, note },
    ip,
  });
}

/** Releases budget held by a reservation or unclaimed reward (deadline passed, completion revoked). */
export async function releaseEntitlement(tx: Db, entitlementId: string, note: string): Promise<boolean> {
  const [entitlement] = await tx.select().from(rewardEntitlements).where(eq(rewardEntitlements.id, entitlementId)).for('update');
  if (!entitlement || !['reserved', 'eligible', 'failed', 'submitted'].includes(entitlement.status)) return false;
  const campaign = await lockCampaign(tx, entitlement.campaignId);
  await tx
    .update(rewardEntitlements)
    .set({ status: 'expired', note, resolvedAt: new Date() })
    .where(eq(rewardEntitlements.id, entitlement.id));
  await commitBudget(tx, campaign, -1);
  return true;
}

function claimBlockedMessage(status: Entitlement['status']): string {
  switch (status) {
    case 'reserved':
      return 'This reward is reserved for you. Complete the course to claim it.';
    case 'rejected':
      return 'This claim was rejected by the community.';
    case 'expired':
      return 'This reward has expired.';
    case 'unfunded':
      return 'The campaign budget ran out before your completion was approved.';
    default:
      return 'This reward cannot be claimed right now.';
  }
}
