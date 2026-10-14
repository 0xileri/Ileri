import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { summarizeRule } from '../../../shared/src/access';
import { loadDescribeContext } from '../access/evaluate';
import { validatePolicy } from '../access/policy';
import { requirementsFor } from '../access/requirements';
import { communities, courses, invites, memberships, users } from '../db/schema';
import { audit } from '../lib/audit';
import { randomToken, sha256 } from '../lib/crypto';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { slugify } from '../lib/misc';
import { parse } from '../lib/validate';
import { activeMembership, loadCommunity, requireCommunityRole, requireUser } from '../permissions';

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(48)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single dashes');

const createBody = z.object({
  name: z.string().trim().min(2).max(80),
  slug: slugSchema.optional(),
  tagline: z.string().trim().max(160).default(''),
  description: z.string().trim().max(5000).default(''),
});

const updateBody = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  tagline: z.string().trim().max(160).optional(),
  description: z.string().trim().max(5000).optional(),
  logoUrl: z.union([z.literal(''), z.url().max(500)]).nullable().optional(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  visibility: z.enum(['public', 'unlisted']).optional(),
  joinPolicy: z.unknown().optional(),
});

const RESERVED_SLUGS = new Set(['new', 'admin', 'api', 'manage', 'settings', 'learn', 'verify']);

export async function communityRoutes(app: FastifyInstance) {
  const { ctx } = app;

  app.get<{ Querystring: { q?: string } }>('/communities', async (req) => {
    const q = (req.query.q ?? '').trim().slice(0, 80);
    const filters = [eq(communities.visibility, 'public'), eq(communities.status, 'active')];
    if (q) filters.push(or(ilike(communities.name, `%${q}%`), ilike(communities.tagline, `%${q}%`))!);
    const rows = await ctx.db
      .select()
      .from(communities)
      .where(and(...filters))
      .orderBy(asc(communities.name))
      .limit(100);
    const ids = rows.map((r) => r.id);
    const memberCounts = ids.length
      ? await ctx.db
          .select({ id: memberships.communityId, n: count() })
          .from(memberships)
          .where(and(inArray(memberships.communityId, ids), eq(memberships.status, 'active')))
          .groupBy(memberships.communityId)
      : [];
    const courseCounts = ids.length
      ? await ctx.db
          .select({ id: courses.communityId, n: count() })
          .from(courses)
          .where(and(inArray(courses.communityId, ids), eq(courses.status, 'published')))
          .groupBy(courses.communityId)
      : [];
    const mine = req.user
      ? await ctx.db
          .select({ id: memberships.communityId, role: memberships.role })
          .from(memberships)
          .where(and(eq(memberships.userId, req.user.id), eq(memberships.status, 'active')))
      : [];
    const describe = await loadDescribeContext(ctx.db, rows.map((r) => r.joinPolicy));
    const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]));
    const members = byId(memberCounts);
    const coursesBy = byId(courseCounts);
    const roles = byId(mine);
    return {
      communities: rows.map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        tagline: c.tagline,
        logoUrl: c.logoUrl,
        accentColor: c.accentColor,
        memberCount: members.get(c.id)?.n ?? 0,
        courseCount: coursesBy.get(c.id)?.n ?? 0,
        joinSummary: summarizeRule(c.joinPolicy, describe),
        myRole: roles.get(c.id)?.role ?? null,
      })),
    };
  });

  app.post('/communities', async (req) => {
    const user = requireUser(req);
    if (ctx.config.communityCreation === 'admin' && !user.isPlatformAdmin) {
      throw forbidden('Only platform administrators can create communities.');
    }
    const body = parse(createBody, req.body);
    const slug = body.slug ?? slugify(body.name);
    if (RESERVED_SLUGS.has(slug)) throw badRequest('That address is reserved. Choose another.');
    const [taken] = await ctx.db.select({ id: communities.id }).from(communities).where(eq(communities.slug, slug));
    if (taken) throw conflict('That community address is taken.', 'slug_taken');
    const community = await ctx.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(communities)
        .values({ name: body.name, slug, tagline: body.tagline, description: body.description, createdBy: user.id })
        .returning();
      await tx.insert(memberships).values({ communityId: row!.id, userId: user.id, role: 'owner' });
      await audit(tx, {
        action: 'community.create',
        actorId: user.id,
        communityId: row!.id,
        targetType: 'community',
        targetId: row!.id,
        ip: req.ip,
      });
      return row!;
    });
    return { community };
  });

  app.get<{ Params: { idOrSlug: string } }>('/communities/:idOrSlug', async (req) => {
    const community = await loadCommunity(ctx.db, req.params.idOrSlug);
    const membership = req.user ? await activeMembership(ctx.db, community.id, req.user.id) : null;
    if (community.status !== 'active' && !req.user?.isPlatformAdmin && !membership) {
      throw new AppError(403, 'suspended', 'This community is currently suspended.');
    }
    const [{ n: memberCount }] = (await ctx.db
      .select({ n: count() })
      .from(memberships)
      .where(and(eq(memberships.communityId, community.id), eq(memberships.status, 'active')))) as [{ n: number }];
    const requirements = await requirementsFor(ctx, [community.joinPolicy], req.user);
    const isOwnerOrAdmin = membership?.role === 'owner' || req.user?.isPlatformAdmin;
    return {
      community: {
        id: community.id,
        slug: community.slug,
        name: community.name,
        tagline: community.tagline,
        description: community.description,
        logoUrl: community.logoUrl,
        accentColor: community.accentColor,
        visibility: community.visibility,
        status: community.status,
        createdAt: community.createdAt,
        memberCount,
        // The raw rule (with allowlists) is only shown to people who can edit it.
        joinPolicy: isOwnerOrAdmin ? community.joinPolicy : undefined,
      },
      membership: membership ? { role: membership.role, joinedAt: membership.joinedAt } : null,
      viewerIsPlatformAdmin: Boolean(req.user?.isPlatformAdmin),
      join: requirements,
    };
  });

  app.patch<{ Params: { id: string } }>('/communities/:id', async (req) => {
    const community = await loadCommunity(ctx.db, req.params.id);
    const actor = await requireCommunityRole(ctx, req, community, 'owner');
    const body = parse(updateBody, req.body);
    const changes: Partial<typeof communities.$inferInsert> = {};
    if (body.name !== undefined) changes.name = body.name;
    if (body.tagline !== undefined) changes.tagline = body.tagline;
    if (body.description !== undefined) changes.description = body.description;
    if (body.logoUrl !== undefined) changes.logoUrl = body.logoUrl || null;
    if (body.accentColor !== undefined) changes.accentColor = body.accentColor;
    if (body.visibility !== undefined) changes.visibility = body.visibility;
    const policyChanged = 'joinPolicy' in (req.body as object);
    if (policyChanged) changes.joinPolicy = await validatePolicy(ctx, community.id, body.joinPolicy);
    if (Object.keys(changes).length === 0) throw badRequest('Nothing to update.');
    await ctx.db.transaction(async (tx) => {
      await tx.update(communities).set(changes).where(eq(communities.id, community.id));
      const describe = policyChanged ? await loadDescribeContext(tx, [community.joinPolicy, changes.joinPolicy]) : {};
      await audit(tx, {
        action: policyChanged ? 'community.policy_update' : 'community.update',
        actorId: actor.user.id,
        communityId: community.id,
        targetType: 'community',
        targetId: community.id,
        metadata: policyChanged
          ? {
              fields: Object.keys(changes),
              before: summarizeRule(community.joinPolicy, describe),
              after: summarizeRule(changes.joinPolicy, describe),
            }
          : { fields: Object.keys(changes) },
        ip: req.ip,
      });
    });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/communities/:id/join', async (req) => {
    const user = requireUser(req);
    const community = await loadCommunity(ctx.db, req.params.id);
    if (community.status !== 'active') throw forbidden('This community is currently suspended.');
    const membership = await joinCommunity(app, community, user, req.ip);
    return { membership: { role: membership.role, joinedAt: membership.joinedAt } };
  });

  app.post<{ Params: { id: string } }>('/communities/:id/leave', async (req) => {
    const user = requireUser(req);
    const community = await loadCommunity(ctx.db, req.params.id);
    const membership = await activeMembership(ctx.db, community.id, user.id);
    if (!membership) throw badRequest('You are not a member of this community.');
    if (membership.role === 'owner') await assertAnotherOwner(app, community.id, user.id);
    await ctx.db.transaction(async (tx) => {
      await tx.update(memberships).set({ status: 'left' }).where(eq(memberships.id, membership.id));
      await audit(tx, { action: 'member.leave', actorId: user.id, communityId: community.id, targetType: 'user', targetId: user.id, ip: req.ip });
    });
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/communities/:id/members', async (req) => {
    const community = await loadCommunity(ctx.db, req.params.id);
    await requireCommunityRole(ctx, req, community, 'member');
    const rows = await ctx.db
      .select({
        userId: users.id,
        displayName: users.displayName,
        role: memberships.role,
        joinedAt: memberships.joinedAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.communityId, community.id), eq(memberships.status, 'active')))
      .orderBy(sql`case ${memberships.role} when 'owner' then 0 when 'instructor' then 1 else 2 end`, asc(users.displayName))
      .limit(1000);
    return { members: rows };
  });

  app.patch<{ Params: { id: string; userId: string } }>('/communities/:id/members/:userId', async (req) => {
    const community = await loadCommunity(ctx.db, req.params.id);
    const actor = await requireCommunityRole(ctx, req, community, 'owner');
    const { role } = parse(z.object({ role: z.enum(['owner', 'instructor', 'member']) }), req.body);
    const target = await activeMembership(ctx.db, community.id, req.params.userId);
    if (!target) throw notFound('Member');
    if (target.role === 'owner' && role !== 'owner') await assertAnotherOwner(app, community.id, target.userId);
    await ctx.db.transaction(async (tx) => {
      await tx.update(memberships).set({ role }).where(eq(memberships.id, target.id));
      await audit(tx, {
        action: 'member.role_change',
        actorId: actor.user.id,
        communityId: community.id,
        targetType: 'user',
        targetId: target.userId,
        metadata: { from: target.role, to: role },
        ip: req.ip,
      });
    });
    return { ok: true };
  });

  app.delete<{ Params: { id: string; userId: string } }>('/communities/:id/members/:userId', async (req) => {
    const community = await loadCommunity(ctx.db, req.params.id);
    const actor = await requireCommunityRole(ctx, req, community, 'owner');
    const target = await activeMembership(ctx.db, community.id, req.params.userId);
    if (!target) throw notFound('Member');
    if (target.role === 'owner') await assertAnotherOwner(app, community.id, target.userId);
    await ctx.db.transaction(async (tx) => {
      await tx.update(memberships).set({ status: 'removed' }).where(eq(memberships.id, target.id));
      await audit(tx, {
        action: 'member.remove',
        actorId: actor.user.id,
        communityId: community.id,
        targetType: 'user',
        targetId: target.userId,
        ip: req.ip,
      });
    });
    return { ok: true };
  });

  // --- Staff invitations -----------------------------------------------------

  app.get<{ Params: { id: string } }>('/communities/:id/invites', async (req) => {
    const community = await loadCommunity(ctx.db, req.params.id);
    await requireCommunityRole(ctx, req, community, 'owner');
    const rows = await ctx.db
      .select({
        id: invites.id,
        role: invites.role,
        note: invites.note,
        maxUses: invites.maxUses,
        uses: invites.uses,
        expiresAt: invites.expiresAt,
        createdAt: invites.createdAt,
      })
      .from(invites)
      .where(and(eq(invites.communityId, community.id), isNull(invites.revokedAt)))
      .orderBy(desc(invites.createdAt));
    return { invites: rows };
  });

  app.post<{ Params: { id: string } }>('/communities/:id/invites', async (req) => {
    const community = await loadCommunity(ctx.db, req.params.id);
    const actor = await requireCommunityRole(ctx, req, community, 'owner');
    const body = parse(
      z.object({
        role: z.enum(['owner', 'instructor']),
        note: z.string().trim().max(200).default(''),
        maxUses: z.number().int().min(1).max(100).default(1),
        expiresInDays: z.number().int().min(1).max(30).default(7),
      }),
      req.body,
    );
    const token = randomToken(24);
    const [invite] = await ctx.db.transaction(async (tx) => {
      const rows = await tx
        .insert(invites)
        .values({
          communityId: community.id,
          tokenHash: sha256(token),
          role: body.role,
          note: body.note,
          maxUses: body.maxUses,
          expiresAt: new Date(Date.now() + body.expiresInDays * 86_400_000),
          createdBy: actor.user.id,
        })
        .returning({ id: invites.id, expiresAt: invites.expiresAt });
      await audit(tx, {
        action: 'invite.create',
        actorId: actor.user.id,
        communityId: community.id,
        targetType: 'invite',
        targetId: rows[0]!.id,
        metadata: { role: body.role, maxUses: body.maxUses },
        ip: req.ip,
      });
      return rows;
    });
    // The raw token is shown once; only its hash is stored.
    return { invite: { id: invite!.id, token, url: `${ctx.config.appOrigins[0]}/invite/${token}`, expiresAt: invite!.expiresAt } };
  });

  app.delete<{ Params: { id: string; inviteId: string } }>('/communities/:id/invites/:inviteId', async (req) => {
    const community = await loadCommunity(ctx.db, req.params.id);
    const actor = await requireCommunityRole(ctx, req, community, 'owner');
    const updated = await ctx.db
      .update(invites)
      .set({ revokedAt: new Date() })
      .where(and(eq(invites.id, req.params.inviteId), eq(invites.communityId, community.id)))
      .returning({ id: invites.id });
    if (!updated.length) throw notFound('Invite');
    await audit(ctx.db, { action: 'invite.revoke', actorId: actor.user.id, communityId: community.id, targetType: 'invite', targetId: req.params.inviteId, ip: req.ip });
    return { ok: true };
  });

  app.get<{ Params: { token: string } }>('/invites/:token', async (req) => {
    const invite = await findUsableInvite(app, req.params.token);
    const [community] = await ctx.db.select().from(communities).where(eq(communities.id, invite.communityId));
    return { invite: { role: invite.role, note: invite.note, expiresAt: invite.expiresAt }, community: { name: community!.name, slug: community!.slug, logoUrl: community!.logoUrl } };
  });

  app.post<{ Params: { token: string } }>('/invites/:token/accept', async (req) => {
    const user = requireUser(req);
    const invite = await findUsableInvite(app, req.params.token);
    const result = await ctx.db.transaction(async (tx) => {
      // Re-check the use count under a row lock so a multi-use link cannot be over-redeemed.
      const [locked] = await tx.select().from(invites).where(eq(invites.id, invite.id)).for('update');
      if (!locked || locked.uses >= locked.maxUses) throw badRequest('This invite has already been used.');
      const [existing] = await tx
        .select()
        .from(memberships)
        .where(and(eq(memberships.communityId, invite.communityId), eq(memberships.userId, user.id)));
      const keepOwner = existing?.status === 'active' && existing.role === 'owner';
      const role = keepOwner ? 'owner' : invite.role;
      if (existing) {
        await tx.update(memberships).set({ role, status: 'active' }).where(eq(memberships.id, existing.id));
      } else {
        await tx.insert(memberships).values({ communityId: invite.communityId, userId: user.id, role });
      }
      await tx.update(invites).set({ uses: locked.uses + 1 }).where(eq(invites.id, invite.id));
      await audit(tx, {
        action: 'invite.accept',
        actorId: user.id,
        communityId: invite.communityId,
        targetType: 'invite',
        targetId: invite.id,
        metadata: { role },
        ip: req.ip,
      });
      return { role };
    });
    const [community] = await ctx.db.select({ slug: communities.slug }).from(communities).where(eq(communities.id, invite.communityId));
    return { ok: true, role: result.role, communitySlug: community!.slug };
  });
}

async function findUsableInvite(app: FastifyInstance, token: string) {
  const [invite] = await app.ctx.db
    .select()
    .from(invites)
    .where(eq(invites.tokenHash, sha256(token)))
    .limit(1);
  if (!invite || invite.revokedAt || invite.expiresAt < new Date() || invite.uses >= invite.maxUses) {
    throw notFound('Invite (it may have expired or been used)');
  }
  return invite;
}

async function assertAnotherOwner(app: FastifyInstance, communityId: string, exceptUserId: string) {
  const owners = await app.ctx.db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.communityId, communityId), eq(memberships.role, 'owner'), eq(memberships.status, 'active')));
  if (!owners.some((o) => o.userId !== exceptUserId)) {
    throw badRequest('A community needs at least one owner. Promote someone else first.');
  }
}

/** Joins a community after checking its gate. Shared with course enrollment. */
export async function joinCommunity(
  app: FastifyInstance,
  community: typeof communities.$inferSelect,
  user: { id: string; displayName: string; isPlatformAdmin: boolean },
  ip: string,
) {
  const { ctx } = app;
  const [existing] = await ctx.db
    .select()
    .from(memberships)
    .where(and(eq(memberships.communityId, community.id), eq(memberships.userId, user.id)))
    .limit(1);
  if (existing?.status === 'active') return existing;
  if (existing?.status === 'removed') {
    throw forbidden('You were removed from this community. Contact its owners if you think this is a mistake.');
  }
  const requirements = await requirementsFor(ctx, [community.joinPolicy], user);
  if (requirements.state === 'unknown') {
    throw new AppError(
      503,
      'eligibility_unavailable',
      "We couldn't check your token holdings right now. Please try again in a minute.",
      { requirements },
    );
  }
  if (requirements.state === 'ineligible') {
    throw new AppError(403, 'not_eligible', `You don't meet the requirements to join ${community.name} yet.`, { requirements });
  }
  return ctx.db.transaction(async (tx) => {
    let row: typeof memberships.$inferSelect;
    if (existing) {
      [row] = (await tx
        .update(memberships)
        .set({ status: 'active', role: 'member', joinedAt: new Date() })
        .where(eq(memberships.id, existing.id))
        .returning()) as [typeof memberships.$inferSelect];
    } else {
      [row] = (await tx
        .insert(memberships)
        .values({ communityId: community.id, userId: user.id, role: 'member' })
        .onConflictDoNothing()
        .returning()) as [typeof memberships.$inferSelect];
      if (!row) {
        // A concurrent request joined first.
        [row] = (await tx
          .select()
          .from(memberships)
          .where(and(eq(memberships.communityId, community.id), eq(memberships.userId, user.id)))) as [
          typeof memberships.$inferSelect,
        ];
        return row;
      }
    }
    await audit(tx, { action: 'member.join', actorId: user.id, communityId: community.id, targetType: 'user', targetId: user.id, ip });
    return row;
  });
}
