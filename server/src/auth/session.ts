import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Db } from '../db';
import { sessions, users } from '../db/schema';
import { randomToken, sha256 } from '../lib/crypto';

export const SESSION_COOKIE = 'ileri_session';

export interface AuthUser {
  id: string;
  displayName: string;
  isPlatformAdmin: boolean;
}

export async function createSession(
  db: Db,
  userId: string,
  days: number,
  userAgent: string | undefined,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({
    tokenHash: sha256(token),
    userId,
    expiresAt,
    userAgent: userAgent?.slice(0, 300) ?? null,
  });
  return { token, expiresAt };
}

export async function resolveSession(db: Db, token: string | undefined): Promise<AuthUser | null> {
  if (!token || token.length > 200) return null;
  const [row] = await db
    .select({ id: users.id, displayName: users.displayName, isPlatformAdmin: users.isPlatformAdmin })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, sha256(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
        eq(users.status, 'active'),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function revokeSession(db: Db, token: string): Promise<void> {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, sha256(token)));
}
