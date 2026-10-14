import { and, eq, inArray, isNotNull, lt, or } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { AppContext } from './context';
import { authNonces, rewardCampaigns, rewardEntitlements, sessions } from './db/schema';
import { releaseEntitlement } from './rewards/service';

interface JobState {
  lastRunAt: string | null;
  lastError: string | null;
  lastResult: Record<string, number> | null;
}

const state = new Map<string, JobState>();

export function jobStatus(): Record<string, JobState> {
  return Object.fromEntries(state);
}

type Job = { name: string; everyMs: number; run: (ctx: AppContext) => Promise<Record<string, number>> };

export const JOBS: Job[] = [
  {
    name: 'campaign-lifecycle',
    everyMs: 60_000,
    run: async (ctx) => {
      const now = new Date();
      // Campaigns past their end date stop allocating; reservations that never became completions are released.
      const ended = await ctx.db
        .update(rewardCampaigns)
        .set({ status: 'ended' })
        .where(and(inArray(rewardCampaigns.status, ['active', 'paused']), isNotNull(rewardCampaigns.endsAt), lt(rewardCampaigns.endsAt, now)))
        .returning({ id: rewardCampaigns.id });
      const stale = await ctx.db
        .select({ id: rewardEntitlements.id, status: rewardEntitlements.status, campaignStatus: rewardCampaigns.status })
        .from(rewardEntitlements)
        .innerJoin(rewardCampaigns, eq(rewardCampaigns.id, rewardEntitlements.campaignId))
        .where(
          or(
            and(eq(rewardEntitlements.status, 'reserved'), eq(rewardCampaigns.status, 'ended')),
            and(
              inArray(rewardEntitlements.status, ['reserved', 'eligible']),
              isNotNull(rewardCampaigns.claimDeadline),
              lt(rewardCampaigns.claimDeadline, now),
            ),
          ),
        )
        .limit(500);
      let released = 0;
      for (const row of stale) {
        const note = row.status === 'reserved' ? 'The campaign ended before the course was completed.' : 'The claim deadline passed.';
        if (await ctx.db.transaction((tx) => releaseEntitlement(tx, row.id, note))) released += 1;
      }
      return { campaignsEnded: ended.length, entitlementsReleased: released };
    },
  },
  {
    name: 'auth-cleanup',
    everyMs: 60 * 60_000,
    run: async (ctx) => {
      const dayAgo = new Date(Date.now() - 24 * 3600_000);
      const nonces = await ctx.db.delete(authNonces).where(lt(authNonces.expiresAt, dayAgo)).returning({ n: authNonces.nonce });
      const old = await ctx.db.delete(sessions).where(lt(sessions.expiresAt, dayAgo)).returning({ id: sessions.id });
      return { noncesDeleted: nonces.length, sessionsDeleted: old.length };
    },
  },
];

export async function runJob(ctx: AppContext, job: Job): Promise<void> {
  const entry: JobState = state.get(job.name) ?? { lastRunAt: null, lastError: null, lastResult: null };
  try {
    entry.lastResult = await job.run(ctx);
    entry.lastError = null;
  } catch (error) {
    entry.lastError = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    entry.lastRunAt = new Date().toISOString();
    state.set(job.name, entry);
  }
}

/** Simple in-process scheduler. Run one instance with jobs enabled in production. */
export function startJobs(ctx: AppContext, log: FastifyBaseLogger): () => void {
  const timers = JOBS.map((job) => {
    const tick = () => runJob(ctx, job).catch((error) => log.error({ err: error, job: job.name }, 'job failed'));
    setTimeout(tick, 5_000).unref();
    return setInterval(tick, job.everyMs);
  });
  timers.forEach((t) => t.unref());
  return () => timers.forEach((t) => clearInterval(t));
}
