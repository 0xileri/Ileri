import { and, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { AppContext } from './context';
import type { Db } from './db';
import { communities, memberships, wallets } from './db/schema';
import type { AuthUser } from './auth/session';
import { forbidden, notFound, unauthenticated } from './lib/errors';
import { isUuid } from './lib/misc';

export type Role = 'owner' | 'instructor' | 'member';
export type Community = typeof communities.$inferSelect;
export type Membership = typeof memberships.$inferSelect;

const RANK: Record<Role, number> = { member: 1, instructor: 2, owner: 3 };

export function hasRole(role: Role | null | undefined, min: Role): boolean {
  return Boolean(role && RANK[role] >= RANK[min]);
}

export function requireUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw unauthenticated();
  return req.user;
}

export async function userWallets(db: Db, userId: string): Promise<string[]> {
  const rows = await db.select({ address: wallets.address }).from(wallets).where(eq(wallets.userId, userId));
  return rows.map((r) => r.address);
}

export async function loadCommunity(db: Db, idOrSlug: string): Promise<Community> {
  const [row] = await db
    .select()
    .from(communities)
    .where(isUuid(idOrSlug) ? eq(communities.id, idOrSlug) : eq(communities.slug, idOrSlug.toLowerCase()))
    .limit(1);
  if (!row) throw notFound('Community');
  return row;
}

/** Active membership only. */
export async function activeMembership(db: Db, communityId: string, userId: string): Promise<Membership | null> {
  const [row] = await db
    .select()
    .from(memberships)
    .where(
      and(eq(memberships.communityId, communityId), eq(memberships.userId, userId), eq(memberships.status, 'active')),
    )
    .limit(1);
  return row ?? null;
}

export interface CommunityActor {
  user: AuthUser;
  /** "admin" means a platform administrator acting outside a community role. */
  role: Role | 'admin';
}

/**
 * Gate for community-scoped management routes. Every staff route goes through
 * here so one community's staff can never act on another community's data.
 */
export async function requireCommunityRole(
  ctx: AppContext,
  req: FastifyRequest,
  community: Community,
  min: Role,
): Promise<CommunityActor> {
  const user = requireUser(req);
  const membership = await activeMembership(ctx.db, community.id, user.id);
  if (membership && hasRole(membership.role, min) && community.status === 'active') {
    return { user, role: membership.role };
  }
  if (user.isPlatformAdmin) return { user, role: 'admin' };
  if (community.status !== 'active') throw forbidden('This community is suspended.');
  throw forbidden(min === 'owner' ? 'Only community owners can do that.' : 'Only community staff can do that.');
}

export function isStaffRole(role: Role | 'admin' | null | undefined): boolean {
  return role === 'admin' || role === 'owner' || role === 'instructor';
}
