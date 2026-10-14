import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEV_ACCOUNTS } from '../../shared/src/devAccounts';
import { ApiClient, content, makeApp, newUser, setupCommunity } from './helpers';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp({ platformAdminWallets: [DEV_ACCOUNTS[0].address] });
});
afterAll(() => app.close());

describe('community isolation and roles', () => {
  it('keeps one community’s staff out of another community’s private data', async () => {
    const a = await setupCommunity(app);
    const b = await setupCommunity(app);
    const learner = await newUser(app);
    await learner.ok('POST', `/api/courses/${b.courseId}/enroll`);
    const { submission } = await learner.ok('POST', `/api/courses/${b.courseId}/submissions`, {
      text: 'A submission in community B that is definitely long enough.',
    });

    const owner = a.owner;
    const probes = [
      owner.get(`/api/communities/${b.communityId}/review-queue`),
      owner.get(`/api/communities/${b.communityId}/analytics`),
      owner.get(`/api/communities/${b.communityId}/audit`),
      owner.get(`/api/communities/${b.communityId}/campaigns`),
      owner.get(`/api/communities/${b.communityId}/invites`),
      owner.get(`/api/courses/${b.courseId}/editor`),
      owner.put(`/api/courses/${b.courseId}/draft`, { content: content() }),
      owner.post(`/api/courses/${b.courseId}/publish`),
      owner.patch(`/api/communities/${b.communityId}`, { name: 'Hijacked' }),
      owner.post(`/api/submissions/${submission.id}/claim`),
      owner.post(`/api/submissions/${submission.id}/review`, { decision: 'approved', rubric: [] }),
    ];
    for (const res of await Promise.all(probes)) expect(res.status).toBe(403);
    expect((await owner.get(`/api/submissions/${submission.id}`)).status).toBe(404);
  });

  it('separates instructor and owner powers', async () => {
    const { owner, communityId, courseId } = await setupCommunity(app);
    const instructor = await newUser(app);
    const invite = await owner.ok('POST', `/api/communities/${communityId}/invites`, { role: 'instructor' });
    await instructor.ok('POST', `/api/invites/${invite.invite.token}/accept`);

    expect((await instructor.get(`/api/communities/${communityId}/review-queue`)).status).toBe(200);
    expect((await instructor.post(`/api/communities/${communityId}/courses`, { title: 'By instructor' })).status).toBe(200);
    expect((await instructor.patch(`/api/communities/${communityId}`, { name: 'Renamed' })).status).toBe(403);
    expect((await instructor.post(`/api/communities/${communityId}/campaigns`, {
      courseId,
      name: 'x',
      rewardKind: 'points',
      amountPerCompletion: 1,
    })).status).toBe(403);
    expect((await instructor.get(`/api/communities/${communityId}/audit`)).status).toBe(403);

    const member = await newUser(app);
    await member.ok('POST', `/api/communities/${communityId}/join`);
    expect((await member.get(`/api/communities/${communityId}/members`)).status).toBe(200);
    expect((await member.get(`/api/communities/${communityId}/review-queue`)).status).toBe(403);

    const me = await owner.ok('GET', '/api/me');
    const demote = await owner.patch(`/api/communities/${communityId}/members/${me.user.id}`, { role: 'member' });
    expect(demote.status).toBe(400);
  });

  it('lets platform admins suspend communities, which blocks learners', async () => {
    const admin = await ApiClient.signIn(app, DEV_ACCOUNTS[0].privateKey);
    expect((await admin.ok('GET', '/api/me')).user.isPlatformAdmin).toBe(true);
    const { communityId, courseId } = await setupCommunity(app);
    const learner = await newUser(app);
    await learner.ok('POST', `/api/courses/${courseId}/enroll`);
    expect((await learner.get('/api/admin/overview')).status).toBe(403);
    await admin.ok('POST', `/api/admin/communities/${communityId}/status`, { status: 'suspended', reason: 'Abuse report' });
    expect((await learner.get(`/api/courses/${courseId}/lessons/l1`)).status).toBe(403);
    const overview = await admin.ok('GET', '/api/admin/overview');
    expect(overview.health.database.ok).toBe(true);
    expect(overview.totals.suspended_communities).toBeGreaterThanOrEqual(1);
    const audit = await admin.ok('GET', '/api/admin/audit?action=admin.');
    expect(audit.events[0].action).toBe('admin.community_status');
  });
});
