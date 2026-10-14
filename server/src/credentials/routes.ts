import { and, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { communities, completions, credentials, rewardEntitlements } from '../db/schema';
import { audit } from '../lib/audit';
import { conflict, notFound } from '../lib/errors';
import { parse } from '../lib/validate';
import { loadCommunity, requireCommunityRole, requireUser } from '../permissions';
import { releaseEntitlement } from '../rewards/service';

export async function credentialRoutes(app: FastifyInstance) {
  const { ctx } = app;

  app.get('/me/credentials', async (req) => {
    const user = requireUser(req);
    const rows = await ctx.db
      .select({
        publicId: credentials.publicId,
        title: credentials.title,
        courseTitle: credentials.courseTitle,
        courseId: credentials.courseId,
        versionNumber: credentials.versionNumber,
        recipientName: credentials.recipientName,
        issuedAt: credentials.issuedAt,
        status: credentials.status,
        revokedReason: credentials.revokedReason,
        communityName: communities.name,
        communitySlug: communities.slug,
        accentColor: communities.accentColor,
      })
      .from(credentials)
      .innerJoin(communities, eq(communities.id, credentials.communityId))
      .where(eq(credentials.userId, user.id))
      .orderBy(desc(credentials.issuedAt));
    return { credentials: rows };
  });

  /** Public verification. Anyone with the link can check issuer and validity. */
  app.get<{ Params: { publicId: string } }>('/credentials/:publicId', async (req) => {
    if (!/^cred_[a-z0-9]{10,40}$/.test(req.params.publicId)) throw notFound('Credential');
    const [row] = await ctx.db
      .select({ credential: credentials, community: communities })
      .from(credentials)
      .innerJoin(communities, eq(communities.id, credentials.communityId))
      .where(eq(credentials.publicId, req.params.publicId));
    if (!row) throw notFound('Credential');
    const { credential: c, community } = row;
    return {
      credential: {
        publicId: c.publicId,
        title: c.title,
        recipientName: c.recipientName,
        courseTitle: c.courseTitle,
        courseId: c.courseId,
        versionNumber: c.versionNumber,
        criteria: c.criteria,
        issuedAt: c.issuedAt,
        status: c.status,
        revokedAt: c.revokedAt,
        revokedReason: c.revokedReason,
      },
      issuer: {
        name: community.name,
        slug: community.slug,
        logoUrl: community.logoUrl,
        accentColor: community.accentColor,
        status: community.status,
      },
      verification: {
        valid: c.status === 'active' && community.status === 'active',
        checkedAt: new Date().toISOString(),
        verifyUrl: `${ctx.config.appOrigins[0]}/verify/${c.publicId}`,
      },
    };
  });

  /**
   * Revokes a credential and the completion behind it (e.g. after misconduct is
   * found). Unclaimed rewards for that completion are released; paid rewards stay
   * in the ledger and are noted in the audit trail.
   */
  app.post<{ Params: { publicId: string } }>('/credentials/:publicId/revoke', async (req) => {
    const { reason } = parse(z.object({ reason: z.string().trim().min(5).max(1000) }), req.body);
    const [credential] = await ctx.db.select().from(credentials).where(eq(credentials.publicId, req.params.publicId));
    if (!credential) throw notFound('Credential');
    const community = await loadCommunity(ctx.db, credential.communityId);
    const actor = await requireCommunityRole(ctx, req, community, 'owner');
    if (credential.status === 'revoked') throw conflict('This credential is already revoked.', 'already_revoked');
    await ctx.db.transaction(async (tx) => {
      const now = new Date();
      await tx
        .update(credentials)
        .set({ status: 'revoked', revokedAt: now, revokedReason: reason, revokedBy: actor.user.id })
        .where(eq(credentials.id, credential.id));
      await tx.update(completions).set({ status: 'revoked' }).where(eq(completions.id, credential.completionId));
      const open = await tx
        .select({ id: rewardEntitlements.id })
        .from(rewardEntitlements)
        .where(
          and(
            eq(rewardEntitlements.completionId, credential.completionId),
            inArray(rewardEntitlements.status, ['eligible', 'submitted', 'failed']),
          ),
        );
      for (const e of open) await releaseEntitlement(tx, e.id, 'Released because the completion was revoked.');
      const paid = await tx
        .select({ id: rewardEntitlements.id, amount: rewardEntitlements.amount })
        .from(rewardEntitlements)
        .where(and(eq(rewardEntitlements.completionId, credential.completionId), eq(rewardEntitlements.status, 'confirmed')));
      await audit(tx, {
        action: 'credential.revoke',
        actorId: actor.user.id,
        communityId: community.id,
        targetType: 'credential',
        targetId: credential.publicId,
        metadata: { reason, learnerId: credential.userId, releasedRewards: open.length, paidRewards: paid },
        ip: req.ip,
      });
    });
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/communities/:id/credentials', async (req) => {
    const community = await loadCommunity(ctx.db, req.params.id);
    await requireCommunityRole(ctx, req, community, 'instructor');
    const rows = await ctx.db
      .select({
        publicId: credentials.publicId,
        title: credentials.title,
        courseTitle: credentials.courseTitle,
        recipientName: credentials.recipientName,
        issuedAt: credentials.issuedAt,
        status: credentials.status,
        revokedReason: credentials.revokedReason,
      })
      .from(credentials)
      .where(eq(credentials.communityId, community.id))
      .orderBy(desc(credentials.issuedAt))
      .limit(500);
    return { credentials: rows };
  });
}
