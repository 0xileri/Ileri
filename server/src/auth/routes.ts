import { and, asc, count, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { communities, memberships, users, wallets } from '../db/schema';
import { audit } from '../lib/audit';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { parse } from '../lib/validate';
import { requireUser } from '../permissions';
import { createSession, revokeSession, SESSION_COOKIE } from './session';
import { issueNonce, verifySiwe } from './siwe';

const verifyBody = z.object({
  message: z.string().min(1).max(4000),
  signature: z.string().min(1).max(10_000),
  /** "link" adds the wallet to the signed-in account instead of signing in. */
  mode: z.enum(['signin', 'link']).default('signin'),
});

const profileBody = z.object({
  displayName: z.string().trim().min(1).max(60).optional(),
  bio: z.string().trim().max(500).optional(),
});

export async function authRoutes(app: FastifyInstance) {
  const { ctx } = app;

  app.get('/config', async () => ({
    devMode: ctx.config.devMode,
    chainMode: ctx.config.chainMode,
    supportedChainIds: ctx.config.supportedChainIds,
    communityCreation: ctx.config.communityCreation,
    siweStatement: 'Sign in to Ileri. This request will not trigger a transaction or cost any gas.',
  }));

  app.get('/auth/nonce', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async () => ({
    nonce: await issueNonce(ctx),
  }));

  app.post('/auth/verify', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(verifyBody, req.body);
    const { address } = await verifySiwe(ctx, body);
    const [existing] = await ctx.db.select().from(wallets).where(eq(wallets.address, address)).limit(1);

    if (body.mode === 'link') {
      const user = requireUser(req);
      if (existing && existing.userId !== user.id) {
        throw conflict('That wallet is already linked to another account.', 'wallet_taken');
      }
      if (!existing) {
        await ctx.db.transaction(async (tx) => {
          await tx.insert(wallets).values({ userId: user.id, address });
          await audit(tx, { action: 'wallet.link', actorId: user.id, targetType: 'wallet', targetId: address, ip: req.ip });
        });
        await ctx.balances.invalidateOwner(address);
      }
      return { ok: true, address };
    }

    let userId: string;
    if (existing) {
      const [user] = await ctx.db.select().from(users).where(eq(users.id, existing.userId)).limit(1);
      if (!user || user.status !== 'active') throw forbidden('This account is suspended.');
      userId = user.id;
      if (ctx.config.platformAdminWallets.includes(address) && !user.isPlatformAdmin) {
        await ctx.db.update(users).set({ isPlatformAdmin: true }).where(eq(users.id, user.id));
      }
    } else {
      userId = await ctx.db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({
            displayName: `Member ${address.slice(2, 6)}`,
            isPlatformAdmin: ctx.config.platformAdminWallets.includes(address),
          })
          .returning({ id: users.id });
        await tx.insert(wallets).values({ userId: user!.id, address });
        await audit(tx, { action: 'user.create', actorId: user!.id, targetType: 'user', targetId: user!.id, ip: req.ip });
        return user!.id;
      });
    }

    const session = await createSession(ctx.db, userId, ctx.config.sessionDays, req.headers['user-agent']);
    setSessionCookie(reply, session.token, session.expiresAt, ctx.config.env === 'production');
    return { ok: true, address, isNewUser: !existing };
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await revokeSession(ctx.db, token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/me', async (req) => {
    if (!req.user) return { user: null };
    const [user] = await ctx.db.select().from(users).where(eq(users.id, req.user.id)).limit(1);
    const walletRows = await ctx.db
      .select({ id: wallets.id, address: wallets.address, verifiedAt: wallets.verifiedAt })
      .from(wallets)
      .where(eq(wallets.userId, req.user.id))
      .orderBy(asc(wallets.verifiedAt));
    const membershipRows = await ctx.db
      .select({
        communityId: communities.id,
        slug: communities.slug,
        name: communities.name,
        logoUrl: communities.logoUrl,
        accentColor: communities.accentColor,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(communities, eq(communities.id, memberships.communityId))
      .where(and(eq(memberships.userId, req.user.id), eq(memberships.status, 'active')))
      .orderBy(asc(communities.name));
    return {
      user: {
        id: user!.id,
        displayName: user!.displayName,
        bio: user!.bio,
        isPlatformAdmin: user!.isPlatformAdmin,
        createdAt: user!.createdAt,
      },
      wallets: walletRows,
      memberships: membershipRows,
    };
  });

  app.patch('/me', async (req) => {
    const user = requireUser(req);
    const body = parse(profileBody, req.body);
    if (Object.keys(body).length === 0) throw badRequest('Nothing to update.');
    await ctx.db.update(users).set(body).where(eq(users.id, user.id));
    return { ok: true };
  });

  app.delete<{ Params: { walletId: string } }>('/me/wallets/:walletId', async (req) => {
    const user = requireUser(req);
    const [{ total }] = (await ctx.db
      .select({ total: count() })
      .from(wallets)
      .where(eq(wallets.userId, user.id))) as [{ total: number }];
    const [wallet] = await ctx.db
      .select()
      .from(wallets)
      .where(and(eq(wallets.id, req.params.walletId), eq(wallets.userId, user.id)))
      .limit(1);
    if (!wallet) throw notFound('Wallet');
    if (total <= 1) throw badRequest('You need at least one wallet to sign in. Link another wallet first.');
    await ctx.db.transaction(async (tx) => {
      await tx.delete(wallets).where(eq(wallets.id, wallet.id));
      await audit(tx, { action: 'wallet.unlink', actorId: user.id, targetType: 'wallet', targetId: wallet.address, ip: req.ip });
    });
    return { ok: true };
  });
}

function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date, secure: boolean) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    expires: expiresAt,
  });
}
