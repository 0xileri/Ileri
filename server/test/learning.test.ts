import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { content, CORRECT, finishLessons, makeApp, newUser, passQuiz, setupCommunity } from './helpers';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(() => app.close());

const essay =
  'Here is my practical analysis of a suspicious message, with three red flags and a verification routine described in detail.';

describe('course versions', () => {
  it('pins learners to the version they enrolled in', async () => {
    const { owner, courseId } = await setupCommunity(app);
    const early = await newUser(app);
    await early.ok('POST', `/api/courses/${courseId}/enroll`);

    await owner.ok('POST', `/api/courses/${courseId}/draft`);
    const v2 = content();
    v2.modules[0]!.lessons.push({ id: 'l3', title: 'New lesson', kind: 'text', body: 'Added in v2' });
    await owner.ok('PUT', `/api/courses/${courseId}/draft`, { content: v2, changeNote: 'Adds lesson three' });
    const published = await owner.ok('POST', `/api/courses/${courseId}/publish`);
    expect(published.versionNumber).toBe(2);

    const late = await newUser(app);
    await late.ok('POST', `/api/courses/${courseId}/enroll`);
    const earlyView = await early.ok('GET', `/api/courses/${courseId}/learn`);
    const lateView = await late.ok('GET', `/api/courses/${courseId}/learn`);
    expect(earlyView.version.versionNumber).toBe(1);
    expect(earlyView.version.isCurrent).toBe(false);
    expect(earlyView.modules[0].lessons).toHaveLength(2);
    expect(lateView.version.versionNumber).toBe(2);
    expect(lateView.modules[0].lessons).toHaveLength(3);
    expect((await early.get(`/api/courses/${courseId}/lessons/l3`)).status).toBe(404);

    const editor = await owner.ok('GET', `/api/courses/${courseId}/editor`);
    expect(editor.versions.map((v: { status: string }) => v.status)).toEqual(['published', 'retired']);
  });

  it('refuses to publish incomplete content and validates drafts', async () => {
    const { owner, communityId } = await setupCommunity(app);
    const { course } = await owner.ok('POST', `/api/communities/${communityId}/courses`, { title: 'Needs work' });
    const broken = content({ quiz: { ...content().quiz!, questionsPerAttempt: 10 } });
    const saved = await owner.ok('PUT', `/api/courses/${course.id}/draft`, { content: broken });
    expect(saved.issues[0]).toMatch(/bank only has 3/);
    const publish = await owner.post(`/api/courses/${course.id}/publish`);
    expect(publish.status).toBe(400);
    expect(publish.body.error.code).toBe('not_publishable');
    const invalid = await owner.put(`/api/courses/${course.id}/draft`, {
      content: content({
        quiz: {
          ...content().quiz!,
          questions: [{ id: 'x', prompt: 'P', kind: 'single', options: [{ id: 'a', text: 'A', correct: true }, { id: 'b', text: 'B', correct: true }] }],
        },
      }),
    });
    expect(invalid.status).toBe(400);
  });
});

describe('quizzes', () => {
  it('never sends answers, grades on the server and enforces attempt limits', async () => {
    const { courseId } = await setupCommunity(app);
    const learner = await newUser(app);
    await learner.ok('POST', `/api/courses/${courseId}/enroll`);
    const { attempt } = await learner.ok('POST', `/api/courses/${courseId}/quiz/attempts`);
    expect(attempt.questions).toHaveLength(2);
    expect(JSON.stringify(attempt)).not.toContain('correct');
    const again = await learner.ok('POST', `/api/courses/${courseId}/quiz/attempts`);
    expect(again.attempt.id).toBe(attempt.id);

    const wrong = Object.fromEntries(attempt.questions.map((q: { id: string }) => [q.id, ['zzz']]));
    const failed = await learner.ok('POST', `/api/quiz-attempts/${attempt.id}/submit`, { answers: wrong });
    expect(failed.result).toMatchObject({ scorePercent: 0, passed: false, attemptsRemaining: 1 });
    expect((await learner.post(`/api/quiz-attempts/${attempt.id}/submit`, { answers: wrong })).status).toBe(409);

    const partial = await passQuiz(learner, courseId, { q1: ['a'], q2: ['a'], q3: ['b'] });
    if (!partial.result.passed) {
      expect(partial.result.attemptsRemaining).toBe(0);
      const blocked = await learner.post(`/api/courses/${courseId}/quiz/attempts`);
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe('attempts_exhausted');
    }
  });

  it('does not let another user submit your attempt', async () => {
    const { courseId } = await setupCommunity(app);
    const learner = await newUser(app);
    const thief = await newUser(app);
    await learner.ok('POST', `/api/courses/${courseId}/enroll`);
    const { attempt } = await learner.ok('POST', `/api/courses/${courseId}/quiz/attempts`);
    expect((await thief.post(`/api/quiz-attempts/${attempt.id}/submit`, { answers: CORRECT })).status).toBe(404);
  });
});

describe('verified completion', () => {
  it('runs submit, review, revision, approval, credential and public verification', async () => {
    const { owner, communityId, courseId } = await setupCommunity(app);
    const learner = await newUser(app, 'Learner Lee');
    await learner.ok('POST', `/api/courses/${courseId}/enroll`);
    await finishLessons(learner, courseId);
    expect((await passQuiz(learner, courseId)).result.passed).toBe(true);

    let view = await learner.ok('GET', `/api/courses/${courseId}/learn`);
    expect(view.stage).toBe('learning');
    expect(view.completion).toBeNull();

    const { submission } = await learner.ok('POST', `/api/courses/${courseId}/submissions`, { text: essay });
    expect((await learner.post(`/api/courses/${courseId}/submissions`, { text: essay })).body.error.code).toBe('review_pending');
    expect((await learner.ok('GET', `/api/courses/${courseId}/learn`)).stage).toBe('submitted');

    const queue = await owner.ok('GET', `/api/communities/${communityId}/review-queue`);
    expect(queue.submissions.map((s: { id: string }) => s.id)).toContain(submission.id);
    await owner.ok('POST', `/api/submissions/${submission.id}/claim`);
    expect((await learner.ok('GET', `/api/courses/${courseId}/learn`)).stage).toBe('under_review');

    const badApprove = await owner.post(`/api/submissions/${submission.id}/review`, {
      decision: 'approved',
      rubric: [
        { criterionId: 'r1', met: false },
        { criterionId: 'r2', met: true },
      ],
    });
    expect(badApprove.status).toBe(400);
    const noComment = await owner.post(`/api/submissions/${submission.id}/review`, {
      decision: 'revision_required',
      rubric: [
        { criterionId: 'r1', met: false },
        { criterionId: 'r2', met: true },
      ],
    });
    expect(noComment.status).toBe(400);
    await owner.ok('POST', `/api/submissions/${submission.id}/review`, {
      decision: 'revision_required',
      rubric: [
        { criterionId: 'r1', met: false, note: 'Only two red flags' },
        { criterionId: 'r2', met: true },
      ],
      comment: 'Add a third red flag.',
    });
    view = await learner.ok('GET', `/api/courses/${courseId}/learn`);
    expect(view.stage).toBe('revision_required');
    expect(view.assignment.submissions[0].reviews[0].comment).toBe('Add a third red flag.');

    const second = await learner.ok('POST', `/api/courses/${courseId}/submissions`, { text: `${essay} Now with a third flag.` });
    expect(second.submission.attemptNumber).toBe(2);
    const approved = await owner.ok('POST', `/api/submissions/${second.submission.id}/review`, {
      decision: 'approved',
      rubric: [
        { criterionId: 'r1', met: true },
        { criterionId: 'r2', met: false },
      ],
      comment: 'Good work.',
    });
    expect(approved.courseCompleted).toBe(true);

    view = await learner.ok('GET', `/api/courses/${courseId}/learn`);
    expect(view.stage).toBe('completed');
    expect(view.progress.percent).toBe(100);
    const publicId = view.completion.credential.publicId;
    expect(publicId).toMatch(/^cred_/);

    const anonymous = await app.inject({ url: `/api/credentials/${publicId}` });
    const verified = anonymous.json();
    expect(verified.verification.valid).toBe(true);
    expect(verified.credential).toMatchObject({ recipientName: 'Learner Lee', courseTitle: 'Course', versionNumber: 1 });

    const audit = await owner.ok('GET', `/api/communities/${communityId}/audit`);
    const actions = audit.events.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['submission.review', 'completion.create', 'credential.issue']));

    expect((await learner.post(`/api/credentials/${publicId}/revoke`, { reason: 'Trying to revoke myself' })).status).toBe(403);
    await owner.ok('POST', `/api/credentials/${publicId}/revoke`, { reason: 'Plagiarism confirmed on review' });
    const revoked = (await app.inject({ url: `/api/credentials/${publicId}` })).json();
    expect(revoked.verification.valid).toBe(false);
    expect(revoked.credential.revokedReason).toBe('Plagiarism confirmed on review');
  });

  it('blocks self-review and flags duplicate submissions', async () => {
    const { owner, communityId, courseId } = await setupCommunity(app);
    const a = await newUser(app);
    const b = await newUser(app);
    for (const learner of [a, b]) {
      await learner.ok('POST', `/api/courses/${courseId}/enroll`);
    }
    await a.ok('POST', `/api/courses/${courseId}/submissions`, { text: essay });
    const copy = await b.ok('POST', `/api/courses/${courseId}/submissions`, { text: essay.toUpperCase() + '!!' });
    const detail = await owner.ok('GET', `/api/submissions/${copy.submission.id}`);
    expect(detail.duplicate).not.toBeNull();

    // An instructor who is also enrolled cannot review their own work.
    await owner.ok('POST', `/api/courses/${courseId}/enroll`);
    const own = await owner.ok('POST', `/api/courses/${courseId}/submissions`, { text: 'Owner work that is long enough to hash for checks.' });
    expect((await owner.post(`/api/submissions/${own.submission.id}/claim`)).status).toBe(403);
    expect(communityId).toBeTruthy();
  });

  it('handles appeals, and only a different owner can overturn', async () => {
    const { owner, communityId, courseId } = await setupCommunity(app);
    const coOwner = await newUser(app, 'Co Owner');
    const invite = await owner.ok('POST', `/api/communities/${communityId}/invites`, { role: 'owner' });
    await coOwner.ok('POST', `/api/invites/${invite.invite.token}/accept`);
    expect((await coOwner.post(`/api/invites/${invite.invite.token}/accept`)).status).toBe(404);

    const learner = await newUser(app);
    await learner.ok('POST', `/api/courses/${courseId}/enroll`);
    await finishLessons(learner, courseId);
    await passQuiz(learner, courseId);
    const { submission } = await learner.ok('POST', `/api/courses/${courseId}/submissions`, { text: essay });
    await owner.ok('POST', `/api/submissions/${submission.id}/review`, {
      decision: 'revision_required',
      rubric: [
        { criterionId: 'r1', met: false },
        { criterionId: 'r2', met: false },
      ],
      comment: 'Not enough detail.',
    });
    expect((await learner.post(`/api/submissions/${submission.id}/appeal`, { reason: 'short' })).status).toBe(400);
    await learner.ok('POST', `/api/submissions/${submission.id}/appeal`, {
      reason: 'I covered every rubric point in the second paragraph. Please take another look.',
    });
    expect((await learner.post(`/api/submissions/${submission.id}/appeal`, { reason: 'Appealing a second time to be sure.' })).status).toBe(409);

    const appeals = await owner.ok('GET', `/api/communities/${communityId}/appeals`);
    const appealId = appeals.appeals[0].id;
    expect((await owner.post(`/api/appeals/${appealId}/resolve`, { outcome: 'overturned', note: 'Fine' })).status).toBe(403);
    const resolved = await coOwner.ok('POST', `/api/appeals/${appealId}/resolve`, { outcome: 'overturned', note: 'The rubric was met.' });
    expect(resolved.courseCompleted).toBe(true);
    const view = await learner.ok('GET', `/api/courses/${courseId}/learn`);
    expect(view.stage).toBe('completed');
    expect(view.assignment.submissions[0].appeal.status).toBe('overturned');
  });
});
