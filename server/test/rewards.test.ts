import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { content, finishLessons, makeApp, newUser, setupCommunity } from './helpers';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(() => app.close());

const lessonsOnly = content({
  quiz: null,
  assignment: null,
  completion: { requireAllLessons: true, requireQuiz: false, requireAssignment: false },
});

async function completer(courseId: string) {
  const learner = await newUser(app);
  await learner.ok('POST', `/api/courses/${courseId}/enroll`);
  await finishLessons(learner, courseId);
  return learner;
}

describe('reward campaigns', () => {
  it('pays the first N approved completions once each, and records the rest as unfunded', async () => {
    const { owner, communityId, courseId } = await setupCommunity(app, { content: lessonsOnly });
    const { campaign } = await owner.ok('POST', `/api/communities/${communityId}/campaigns`, {
      courseId,
      name: 'First two',
      rewardKind: 'points',
      amountPerCompletion: 10,
      maxRewards: 2,
      activate: true,
    });
    const preview = await (await newUser(app)).ok('GET', `/api/courses/${courseId}`);
    expect(preview.campaigns[0]).toMatchObject({ remaining: 2, amountPerCompletion: 10 });

    const [a, b, c] = [await completer(courseId), await completer(courseId), await completer(courseId)];
    const rewardsA = await a.ok('GET', '/api/me/rewards');
    expect(rewardsA.rewards[0].status).toBe('eligible');
    const id = rewardsA.rewards[0].id;

    // Double-clicks and retries must never create a second payout.
    const results = await Promise.all([a.post(`/api/me/rewards/${id}/claim`), a.post(`/api/me/rewards/${id}/claim`)]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    await a.ok('POST', `/api/me/rewards/${id}/claim`);
    const after = await a.ok('GET', '/api/me/rewards');
    expect(after.rewards[0].status).toBe('confirmed');
    expect(after.balances).toEqual([expect.objectContaining({ kind: 'points', balance: 10 })]);
    expect(after.ledger).toHaveLength(1);

    expect((await b.ok('GET', '/api/me/rewards')).rewards[0].status).toBe('eligible');
    const third = await c.ok('GET', '/api/me/rewards');
    expect(third.rewards[0].status).toBe('unfunded');
    expect((await c.post(`/api/me/rewards/${third.rewards[0].id}/claim`)).status).toBe(409);

    const list = await owner.ok('GET', `/api/communities/${communityId}/campaigns`);
    const row = list.campaigns.find((x: { id: string }) => x.id === campaign.id);
    expect(row).toMatchObject({ allocatedCount: 2, allocatedAmount: 20, paidAmount: 10, remaining: 0 });
    expect((await owner.patch(`/api/campaigns/${campaign.id}`, { maxRewards: 1 })).status).toBe(400);
  });

  it('reserves budget at enrollment for guaranteed campaigns', async () => {
    const { owner, communityId, courseId } = await setupCommunity(app, { content: lessonsOnly });
    const missingCap = await owner.post(`/api/communities/${communityId}/campaigns`, {
      courseId,
      name: 'Uncapped',
      rewardKind: 'course_credits',
      amountPerCompletion: 5,
      allocationMode: 'reserved_at_enrollment',
    });
    expect(missingCap.status).toBe(400);
    await owner.ok('POST', `/api/communities/${communityId}/campaigns`, {
      courseId,
      name: 'Guaranteed',
      rewardKind: 'course_credits',
      amountPerCompletion: 5,
      maxRewards: 1,
      allocationMode: 'reserved_at_enrollment',
      activate: true,
    });
    const first = await newUser(app);
    await first.ok('POST', `/api/courses/${courseId}/enroll`);
    expect((await first.ok('GET', '/api/me/rewards')).rewards[0].status).toBe('reserved');
    const second = await newUser(app);
    await second.ok('POST', `/api/courses/${courseId}/enroll`);
    expect((await second.ok('GET', '/api/me/rewards')).rewards).toHaveLength(0);

    await finishLessons(first, courseId);
    expect((await first.ok('GET', '/api/me/rewards')).rewards[0].status).toBe('eligible');
    await finishLessons(second, courseId);
    expect((await second.ok('GET', '/api/me/rewards')).rewards[0].status).toBe('unfunded');
  });

  it('routes claims through owner approval when required', async () => {
    const { owner, communityId, courseId } = await setupCommunity(app, { content: lessonsOnly });
    await owner.ok('POST', `/api/communities/${communityId}/campaigns`, {
      courseId,
      name: 'Reviewed',
      rewardKind: 'points',
      amountPerCompletion: 50,
      requiresApproval: true,
      activate: true,
    });
    const a = await completer(courseId);
    const b = await completer(courseId);
    const [ra] = (await a.ok('GET', '/api/me/rewards')).rewards;
    const [rb] = (await b.ok('GET', '/api/me/rewards')).rewards;
    expect((await a.ok('POST', `/api/me/rewards/${ra.id}/claim`)).reward.status).toBe('submitted');
    await b.ok('POST', `/api/me/rewards/${rb.id}/claim`);
    const pending = await owner.ok('GET', `/api/communities/${communityId}/reward-claims`);
    expect(pending.claims).toHaveLength(2);
    expect((await a.post(`/api/reward-claims/${ra.id}/decision`, { decision: 'approve' })).status).toBe(403);
    await owner.ok('POST', `/api/reward-claims/${ra.id}/decision`, { decision: 'approve' });
    expect((await owner.post(`/api/reward-claims/${rb.id}/decision`, { decision: 'reject' })).status).toBe(400);
    await owner.ok('POST', `/api/reward-claims/${rb.id}/decision`, { decision: 'reject', note: 'Duplicate account' });
    expect((await owner.post(`/api/reward-claims/${ra.id}/decision`, { decision: 'approve' })).status).toBe(409);
    expect((await a.ok('GET', '/api/me/rewards')).balances[0].balance).toBe(50);
    expect((await b.ok('GET', '/api/me/rewards')).rewards[0]).toMatchObject({ status: 'rejected', note: 'Duplicate account' });
  });

  it('spends course credits on enrollment, never twice and never below zero', async () => {
    const { owner, communityId, courseId } = await setupCommunity(app, { content: lessonsOnly });
    const { course } = await owner.ok('POST', `/api/communities/${communityId}/courses`, { title: 'Paid course' });
    await owner.ok('PUT', `/api/courses/${course.id}/draft`, { content: lessonsOnly });
    await owner.ok('POST', `/api/courses/${course.id}/publish`);
    await owner.ok('PATCH', `/api/courses/${course.id}`, { creditCost: 30 });
    await owner.ok('POST', `/api/communities/${communityId}/campaigns`, {
      courseId,
      name: 'Credits',
      rewardKind: 'course_credits',
      amountPerCompletion: 40,
      activate: true,
    });
    const learner = await completer(courseId);
    const poor = await newUser(app);
    await poor.ok('POST', `/api/courses/${courseId}/enroll`);
    const denied = await poor.post(`/api/courses/${course.id}/enroll`);
    expect(denied.status).toBe(402);
    expect(denied.body.error.code).toBe('insufficient_credits');

    const [reward] = (await learner.ok('GET', '/api/me/rewards')).rewards;
    await learner.ok('POST', `/api/me/rewards/${reward.id}/claim`);
    await Promise.all([learner.post(`/api/courses/${course.id}/enroll`), learner.post(`/api/courses/${course.id}/enroll`)]);
    const after = await learner.ok('GET', '/api/me/rewards');
    expect(after.balances.find((b: { kind: string }) => b.kind === 'course_credits').balance).toBe(10);
  });

  it('releases unclaimed rewards when a completion is revoked', async () => {
    const { owner, communityId, courseId } = await setupCommunity(app, { content: lessonsOnly });
    const { campaign } = await owner.ok('POST', `/api/communities/${communityId}/campaigns`, {
      courseId,
      name: 'Revocable',
      rewardKind: 'points',
      amountPerCompletion: 5,
      maxRewards: 1,
      activate: true,
    });
    const learner = await completer(courseId);
    const creds = await learner.ok('GET', '/api/me/credentials');
    await owner.ok('POST', `/api/credentials/${creds.credentials[0].publicId}/revoke`, { reason: 'Account sharing' });
    expect((await learner.ok('GET', '/api/me/rewards')).rewards[0].status).toBe('expired');
    const list = await owner.ok('GET', `/api/communities/${communityId}/campaigns`);
    expect(list.campaigns.find((x: { id: string }) => x.id === campaign.id).remaining).toBe(1);
  });
});
