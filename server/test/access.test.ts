import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { combineStates, summarizeRule } from '../../shared/src/access';
import { MockChainReader } from '../src/chain/mockReader';
import { content, CORRECT, finishLessons, giveToken, makeApp, newKey, newUser, passQuiz, PASS, setupCommunity } from './helpers';

const passRule = { type: 'erc721', ...PASS, minBalance: 1, label: 'Test Pass' };

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(() => app.close());

function setChainDown(target: FastifyInstance, down: boolean) {
  (target.ctx.chain as MockChainReader).down = down;
}

describe('access rules', () => {
  it('uses three-valued logic so outages are never read as "not eligible"', () => {
    expect(combineStates('all', ['eligible', 'unknown'])).toBe('unknown');
    expect(combineStates('all', ['ineligible', 'unknown'])).toBe('ineligible');
    expect(combineStates('any', ['eligible', 'unknown'])).toBe('eligible');
    expect(combineStates('any', ['ineligible', 'unknown'])).toBe('unknown');
  });

  it('describes rules in plain language', () => {
    expect(summarizeRule({ type: 'erc721', chainId: 8453, contract: PASS.contract, minBalance: 1, label: 'Guild Pass' })).toBe(
      'Hold an NFT from Guild Pass on Base',
    );
    expect(
      summarizeRule(
        {
          type: 'all',
          rules: [
            { type: 'erc20', chainId: 8453, contract: PASS.contract, minAmount: '100', decimals: 18, symbol: 'ILR' },
            { type: 'course_completion', courseId: '00000000-0000-4000-8000-000000000000' },
          ],
        },
        { courseTitles: { '00000000-0000-4000-8000-000000000000': 'Intro' } },
      ),
    ).toBe('Hold at least 100 ILR of 0x0000…c0de on Base and complete "Intro"');
  });

  it('gates joining a community and explains why', async () => {
    const { communityId } = await setupCommunity(app, { joinPolicy: passRule });
    const learner = await newUser(app);
    const denied = await learner.post(`/api/communities/${communityId}/join`);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('not_eligible');
    expect(denied.body.error.details.requirements.result.text).toBe('Hold an NFT from Test Pass on Base');
    expect(denied.body.error.details.requirements.result.state).toBe('ineligible');

    await giveToken(learner, learner.walletAddress);
    expect((await learner.post(`/api/communities/${communityId}/join`)).status).toBe(200);
  });

  it('rejects policies on unsupported chains or foreign prerequisite courses', async () => {
    const { owner, communityId } = await setupCommunity(app);
    const bad = await owner.patch(`/api/communities/${communityId}`, { joinPolicy: { ...passRule, chainId: 1 } });
    expect(bad.status).toBe(400);
    const other = await setupCommunity(app);
    const foreign = await owner.patch(`/api/communities/${communityId}`, {
      joinPolicy: { type: 'course_completion', courseId: other.courseId },
    });
    expect(foreign.status).toBe(400);
  });

  it('supports ERC-20, ERC-1155, allowlists and any/all groups, summing across linked wallets', async () => {
    const allowed = newKey();
    const policy = {
      type: 'any',
      rules: [
        { type: 'erc20', chainId: 8453, contract: PASS.contract, minAmount: '1.5', decimals: 18, symbol: 'ILR' },
        { type: 'erc1155', chainId: 8453, contract: PASS.contract, tokenId: '7', minBalance: 2 },
        { type: 'allowlist', addresses: [allowed.address] },
      ],
    };
    const { communityId } = await setupCommunity(app, { joinPolicy: policy });

    const erc20Holder = await newUser(app);
    const second = newKey();
    await erc20Holder.linkWallet(second.key);
    await giveToken(erc20Holder, erc20Holder.walletAddress, '1000000000000000000', { standard: 'erc20' });
    expect((await erc20Holder.post(`/api/communities/${communityId}/join`)).status).toBe(403);
    await giveToken(erc20Holder, second.address, '500000000000000000', { standard: 'erc20' });
    expect((await erc20Holder.post(`/api/communities/${communityId}/join`)).status).toBe(200);

    const multi = await newUser(app);
    await giveToken(multi, multi.walletAddress, '1', { standard: 'erc1155', tokenId: '7' });
    expect((await multi.post(`/api/communities/${communityId}/join`)).status).toBe(403);
    await giveToken(multi, multi.walletAddress, '2', { standard: 'erc1155', tokenId: '7' });
    expect((await multi.post(`/api/communities/${communityId}/join`)).status).toBe(200);

    const { ApiClient } = await import('./helpers');
    const listed = await ApiClient.signIn(app, allowed.key);
    expect((await listed.post(`/api/communities/${communityId}/join`)).status).toBe(200);
  });

  it('suspends gated content when a learner loses eligibility, keeping progress and credentials', async () => {
    const { communityId, courseId } = await setupCommunity(app, {
      joinPolicy: passRule,
      content: content({ assignment: null, completion: { requireAllLessons: true, requireQuiz: true, requireAssignment: false } }),
    });
    const learner = await newUser(app);
    await giveToken(learner, learner.walletAddress);
    await learner.ok('POST', `/api/courses/${courseId}/enroll`);
    await finishLessons(learner, courseId);
    const result = await passQuiz(learner, courseId, CORRECT);
    expect(result.result.courseCompleted).toBe(true);

    await giveToken(learner, learner.walletAddress, '0');
    const lesson = await learner.get(`/api/courses/${courseId}/lessons/l1`);
    expect(lesson.status).toBe(403);
    expect(lesson.body.error.code).toBe('access_suspended');

    const view = await learner.ok('GET', `/api/courses/${courseId}/learn`);
    expect(view.access.state).toBe('denied');
    expect(view.progress.percent).toBe(100);
    expect(view.modules[0].lessons.every((l: { completed: boolean }) => l.completed)).toBe(true);
    const creds = await learner.ok('GET', '/api/me/credentials');
    expect(creds.credentials).toHaveLength(1);
    expect(creds.credentials[0].status).toBe('active');

    await giveToken(learner, learner.walletAddress, '1');
    expect((await learner.get(`/api/courses/${courseId}/lessons/l1`)).status).toBe(200);
    expect(communityId).toBeTruthy();
  });

  it('shows a retry message instead of revoking access during a chain outage', async () => {
    const { courseId } = await setupCommunity(app, { joinPolicy: passRule });
    const learner = await newUser(app);
    await giveToken(learner, learner.walletAddress);
    await learner.ok('POST', `/api/courses/${courseId}/enroll`);
    setChainDown(app, true);
    try {
      const lesson = await learner.get(`/api/courses/${courseId}/lessons/l1`);
      expect(lesson.status).toBe(503);
      expect(lesson.body.error.code).toBe('eligibility_unavailable');
      const view = await learner.ok('GET', `/api/courses/${courseId}/learn`);
      expect(view.access.state).toBe('unavailable');
      const newcomer = await newUser(app);
      const join = await newcomer.post(`/api/courses/${courseId}/enroll`);
      expect(join.status).toBe(503);
    } finally {
      setChainDown(app, false);
    }
    expect((await learner.get(`/api/courses/${courseId}/lessons/l1`)).status).toBe(200);
  });

  it('serves a recent cached balance during an outage when a grace window is configured', async () => {
    const graceApp = await makeApp({ balanceCacheTtlSeconds: 0, balanceStaleGraceSeconds: 3600 });
    try {
      const { courseId } = await setupCommunity(graceApp, { joinPolicy: passRule });
      const learner = await newUser(graceApp);
      await giveToken(learner, learner.walletAddress);
      await learner.ok('POST', `/api/courses/${courseId}/enroll`);
      setChainDown(graceApp, true);
      expect((await learner.get(`/api/courses/${courseId}/lessons/l1`)).status).toBe(200);
    } finally {
      await graceApp.close();
    }
  });

  it('requires prerequisite completion for gated courses', async () => {
    const { owner, communityId, courseId: intro } = await setupCommunity(app, {
      content: content({ quiz: null, assignment: null, completion: { requireAllLessons: true, requireQuiz: false, requireAssignment: false } }),
    });
    const { course } = await owner.ok('POST', `/api/communities/${communityId}/courses`, { title: 'Advanced' });
    await owner.ok('PUT', `/api/courses/${course.id}/draft`, { content: content() });
    await owner.ok('POST', `/api/courses/${course.id}/publish`);
    await owner.ok('PATCH', `/api/courses/${course.id}`, { accessPolicy: { type: 'course_completion', courseId: intro } });
    expect((await owner.patch(`/api/courses/${course.id}`, { accessPolicy: { type: 'course_completion', courseId: course.id } })).status).toBe(400);

    const learner = await newUser(app);
    const preview = await learner.ok('GET', `/api/courses/${course.id}`);
    expect(preview.access.state).toBe('ineligible');
    expect(preview.access.summary).toBe('Complete "Course"');
    expect((await learner.post(`/api/courses/${course.id}/enroll`)).status).toBe(403);
    await learner.ok('POST', `/api/courses/${intro}/enroll`);
    await finishLessons(learner, intro);
    expect((await learner.post(`/api/courses/${course.id}/enroll`)).status).toBe(200);
  });

  it('lets staff bypass gates and hides drafts from learners', async () => {
    const { owner, communityId } = await setupCommunity(app, { joinPolicy: passRule });
    const { course } = await owner.ok('POST', `/api/communities/${communityId}/courses`, { title: 'Draft only' });
    const learner = await newUser(app);
    expect((await learner.get(`/api/courses/${course.id}`)).status).toBe(404);
    expect((await owner.get(`/api/courses/${course.id}`)).status).toBe(200);
    const list = await learner.ok('GET', `/api/communities/${communityId}/courses`);
    expect(list.courses.map((c: { id: string }) => c.id)).not.toContain(course.id);
  });
});
