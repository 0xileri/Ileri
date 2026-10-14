import { and, eq } from 'drizzle-orm';
import type { Db } from '../db';
import { balanceCache } from '../db/schema';
import type { HealthTracker } from './health';
import type { BalanceQuery, ChainReader } from './types';

export interface BalanceResult {
  balance: bigint;
  /** True when served from cache past its TTL because the chain was unreachable. */
  stale: boolean;
}

export interface BalanceServiceOptions {
  ttlSeconds: number;
  graceSeconds: number;
  timeoutMs: number;
}

/**
 * Reads token balances through a database cache. When the provider fails we fall
 * back to a recent cached value, and otherwise report "unknown" (null) so callers
 * can ask the learner to retry instead of wrongly revoking access.
 */
export class BalanceService {
  constructor(
    private readonly db: Db,
    readonly reader: ChainReader,
    private readonly options: BalanceServiceOptions,
    private readonly health: HealthTracker,
  ) {}

  private key(q: BalanceQuery) {
    return {
      chainId: q.chainId,
      standard: q.standard,
      contract: q.contract.toLowerCase(),
      tokenId: q.standard === 'erc1155' ? (q.tokenId ?? '0') : '',
      owner: q.owner.toLowerCase(),
    };
  }

  async get(q: BalanceQuery): Promise<BalanceResult | null> {
    const key = this.key(q);
    const where = and(
      eq(balanceCache.chainId, key.chainId),
      eq(balanceCache.standard, key.standard),
      eq(balanceCache.contract, key.contract),
      eq(balanceCache.tokenId, key.tokenId),
      eq(balanceCache.owner, key.owner),
    );
    const [cached] = await this.db.select().from(balanceCache).where(where).limit(1);
    const ageMs = cached ? Date.now() - cached.fetchedAt.getTime() : Number.POSITIVE_INFINITY;
    if (cached && ageMs < this.options.ttlSeconds * 1000) {
      return { balance: BigInt(cached.balance), stale: false };
    }

    try {
      const balance = await withTimeout(this.reader.balanceOf({ ...q, ...key }), this.options.timeoutMs);
      this.health.ok('chain');
      const fetchedAt = new Date();
      await this.db
        .insert(balanceCache)
        .values({ ...key, balance: balance.toString(), fetchedAt })
        .onConflictDoUpdate({
          target: [balanceCache.chainId, balanceCache.standard, balanceCache.contract, balanceCache.tokenId, balanceCache.owner],
          set: { balance: balance.toString(), fetchedAt },
        });
      return { balance, stale: false };
    } catch (error) {
      this.health.fail('chain', error);
      if (cached && ageMs < this.options.graceSeconds * 1000) {
        return { balance: BigInt(cached.balance), stale: true };
      }
      return null;
    }
  }

  async invalidateOwner(owner: string): Promise<void> {
    await this.db.delete(balanceCache).where(eq(balanceCache.owner, owner.toLowerCase()));
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Chain request timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
