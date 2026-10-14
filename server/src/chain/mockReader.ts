import { and, eq } from 'drizzle-orm';
import type { Db } from '../db';
import { devBalances } from '../db/schema';
import type { BalanceQuery, ChainReader } from './types';
import { ChainUnavailableError } from './types';

/**
 * Development chain backed by the dev_balances table, so the whole product can be
 * exercised without RPC access. Set `down` to simulate a provider outage.
 */
export class MockChainReader implements ChainReader {
  readonly kind = 'mock' as const;
  down = false;

  constructor(private readonly db: Db) {}

  async balanceOf(q: BalanceQuery): Promise<bigint> {
    if (this.down) throw new ChainUnavailableError('Simulated RPC outage');
    const rows = await this.db
      .select({ balance: devBalances.balance })
      .from(devBalances)
      .where(
        and(
          eq(devBalances.chainId, q.chainId),
          eq(devBalances.standard, q.standard),
          eq(devBalances.contract, q.contract.toLowerCase()),
          eq(devBalances.tokenId, q.standard === 'erc1155' ? (q.tokenId ?? '0') : ''),
          eq(devBalances.owner, q.owner.toLowerCase()),
        ),
      )
      .limit(1);
    return rows[0] ? BigInt(rows[0].balance) : 0n;
  }
}
