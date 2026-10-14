import { desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { auditPage } from '../analytics/routes';
import { communities, sessions, users, wallets } from '../db/schema';
import { audit } from '../lib/audit';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { isUuid } from '../lib/misc';
import { parse } from '../lib/validate';
import { requireUser } from '../permissions';
import { listAppeals } from '../reviews/routes';
import { jobStatus } from '../jobs';

function requireAdmin(req: FastifyRequest) {
  const user = requireUser(req);
  if (!user.isPlatformAdmin) throw forbidden('Platform administrators only.');
  return user;
}

export async function adminRoutes(app: FastifyInstance) {
  const { ctx } = app;

  app.get('/admin/overview', async (req) => {
    requireAdmin(req);
    const totals = ((await ctx.db.execute(sql`
      select
        (select count(*) from users)::int as users,
        (select count(*) from communities)::int as communities,
        (select count(*) from communities where status = 'suspended')::int as suspended_communities,
        (select count(*) from courses where status = 'published')::int as published_courses,
        (select count(*) from enrollments)::int as enrollments,
        (select count(*) from completions where status = 'valid')::int as completions,
        (select count(*) from appeals where status = 'open')::int as open_appeals,
        (select count(*) from submissions where status in ('submitted', 'under_review'))::int as open_reviews,
        (select count(*) from reward_entitlements where status = 'submitted')::int as pending_claims
    `)) as unknown as { rows: Record<string, number>[] }).rows[0];
    return {
      totals,
      health: {
        database: { ok: await ctx.database.ping(), kind: ctx.database.kind },
        chain: { mode: ctx.chain.kind, supportedChainIds: ctx.config.supportedChainIds, ...ctx.health.snapshot().chain },
        jobs: jobStatus(),
        uptimeSeconds: Math.round(process.uptime()),
      },
    };
  });

  app.get<{ Querystring: { q?: string } }>('/admin/communities', async (req) => {
    requireAdmin(req);
    const q = (req.query.q ?? '').trim().slice(0, 80);
    const rows = await ctx.db
      .select({
        id: communities.id,
        slug: communities.slug,
        name: communities.name,
        status: communities.status,
        visibility: communities.visibility,
        createdAt: communities.createdAt,
        members: sql<number>`(select count(*) from memberships m where m.community_id = ${communities.id} and m.status = 'active')::int`,
        courses: sql<number>`(select count(*) from courses c where c.community_id = ${communities.id})::int`,
      })
      .from(communities)
      .where(q ? ilike(communities.name, `%${q}%`) : undefined)
      .orderBy(desc(communities.createdAt))
      .limit(200);
    return { communities: rows };
  });

  app.post<{ Params: { id: string } }>('/admin/communities/:id/status', async (req) => {
    const admin = requireAdmin(req);
    if (!isUuid(req.params.id)) throw notFound('Community');
    const body = parse(z.object({ status: z.enum(['active', 'suspended']), reason: z.string().trim().min(3).max(500) }), req.body);
    const updated = await ctx.db.update(communities).set({ status: body.status }).where(eq(communities.id, req.params.id)).returning({ id: communities.id });
    if (!updated.length) throw notFound('Community');
    await audit(ctx.db, {
      action: 'admin.community_status',
      actorId: admin.id,
      communityId: req.params.id,
      targetType: 'community',
      targetId: req.params.id,
      metadata: body,
      ip: req.ip,
    });
    return { ok: true };
  });

  app.get<{ Querystring: { q?: string } }>('/admin/users', async (req) => {
    requireAdmin(req);
    const q = (req.query.q ?? '').trim().toLowerCase().slice(0, 80);
    const matchingWallets = q.startsWith('0x')
      ? await ctx.db.select({ userId: wallets.userId }).from(wallets).where(ilike(wallets.address, `${q}%`)).limit(50)
      : [];
    const where = !q
      ? undefined
      : q.startsWith('0x')
        ? matchingWallets.length
          ? inArray(users.id, matchingWallets.map((w) => w.userId))
          : sql`false`
        : ilike(users.displayName, `%${q}%`);
    const rows = await ctx.db
      .select({
        id: users.id,
        displayName: users.displayName,
        status: users.status,
        isPlatformAdmin: users.isPlatformAdmin,
        createdAt: users.createdAt,
        wallets: sql<string[]>`coalesce((select array_agg(w.address) from wallets w where w.user_id = ${users.id}), '{}')`,
        communities: sql<number>`(select count(*) from memberships m where m.user_id = ${users.id} and m.status = 'active')::int`,
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(100);
    return { users: rows };
  });

  app.post<{ Params: { id: string } }>('/admin/users/:id/status', async (req) => {
    const admin = requireAdmin(req);
    if (!isUuid(req.params.id)) throw notFound('User');
    if (req.params.id === admin.id) throw badRequest('You cannot change your own status.');
    const body = parse(z.object({ status: z.enum(['active', 'suspended']), reason: z.string().trim().min(3).max(500) }), req.body);
    await ctx.db.transaction(async (tx) => {
      const updated = await tx.update(users).set({ status: body.status }).where(eq(users.id, req.params.id)).returning({ id: users.id });
      if (!updated.length) throw notFound('User');
      if (body.status === 'suspended') {
        await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, req.params.id));
      }
      await audit(tx, { action: 'admin.user_status', actorId: admin.id, targetType: 'user', targetId: req.params.id, metadata: body, ip: req.ip });
    });
    return { ok: true };
  });

  app.get<{ Querystring: { status?: string } }>('/admin/appeals', async (req) => {
    requireAdmin(req);
    const rows = await listAppeals(ctx, null, req.query.status === 'all');
    const ids = [...new Set(rows.map((r) => r.communityId))];
    const names = ids.length
      ? await ctx.db.select({ id: communities.id, name: communities.name, slug: communities.slug }).from(communities).where(inArray(communities.id, ids))
      : [];
    return { appeals: rows.map((r) => ({ ...r, community: names.find((n) => n.id === r.communityId) ?? null })) };
  });

  app.get<{ Querystring: { before?: string; action?: string; communityId?: string } }>('/admin/audit', async (req) => {
    requireAdmin(req);
    const communityId = req.query.communityId && isUuid(req.query.communityId) ? req.query.communityId : null;
    return { events: await auditPage(app, communityId, req.query) };
  });
}
