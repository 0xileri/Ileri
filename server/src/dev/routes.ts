import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MockChainReader } from '../chain/mockReader';
import { devBalances } from '../db/schema';
import { badRequest, forbidden } from '../lib/errors';
import { parse } from '../lib/validate';
import { requireUser, userWallets } from '../permissions';

/** Development-only tools for simulating token holdings and chain outages. */
export async function devRoutes(app: FastifyInstance) {
  const { ctx } = app;

  app.get('/dev/balances', async (req) => {
    const user = requireUser(req);
    const addresses = await userWallets(ctx.db, user.id);
    const rows = addresses.length ? await ctx.db.select().from(devBalances).where(inArray(devBalances.owner, addresses)) : [];
    return { balances: rows, wallets: addresses };
  });

  app.put('/dev/balances', async (req) => {
    const user = requireUser(req);
    if (ctx.chain.kind !== 'mock') throw badRequest('Test balances only work with CHAIN_MODE=mock.');
    const body = parse(
      z.object({
        owner: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        chainId: z.number().int().positive(),
        standard: z.enum(['erc20', 'erc721', 'erc1155']),
        contract: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        tokenId: z.string().regex(/^\d{1,78}$/).optional(),
        balance: z.string().regex(/^\d{1,78}$/),
      }),
      req.body,
    );
    const owner = body.owner.toLowerCase();
    if (!(await userWallets(ctx.db, user.id)).includes(owner)) throw forbidden('You can only set balances for your own wallets.');
    const key = {
      chainId: body.chainId,
      standard: body.standard,
      contract: body.contract.toLowerCase(),
      tokenId: body.standard === 'erc1155' ? (body.tokenId ?? '0') : '',
      owner,
    };
    if (body.balance === '0') {
      await ctx.db
        .delete(devBalances)
        .where(
          and(
            eq(devBalances.chainId, key.chainId),
            eq(devBalances.standard, key.standard),
            eq(devBalances.contract, key.contract),
            eq(devBalances.tokenId, key.tokenId),
            eq(devBalances.owner, key.owner),
          ),
        );
    } else {
      await ctx.db
        .insert(devBalances)
        .values({ ...key, balance: body.balance })
        .onConflictDoUpdate({
          target: [devBalances.chainId, devBalances.standard, devBalances.contract, devBalances.tokenId, devBalances.owner],
          set: { balance: body.balance },
        });
    }
    await ctx.balances.invalidateOwner(owner);
    return { ok: true };
  });

  app.get('/dev/chain', async () => ({
    mode: ctx.chain.kind,
    down: ctx.chain instanceof MockChainReader ? ctx.chain.down : false,
  }));

  app.post('/dev/chain', async (req) => {
    requireUser(req);
    const { down } = parse(z.object({ down: z.boolean() }), req.body);
    if (!(ctx.chain instanceof MockChainReader)) throw badRequest('Outage simulation only works with CHAIN_MODE=mock.');
    ctx.chain.down = down;
    return { ok: true, down };
  });
}
