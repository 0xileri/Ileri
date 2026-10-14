import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { content, makeApp, newUser, setupCommunity } from './helpers';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(() => app.close());

function multipart(filename: string, type: string, data: string) {
  const boundary = '----ileritest';
  const body =
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n` +
    `${data}\r\n--${boundary}--\r\n`;
  return { payload: body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe('private media', () => {
  it('serves lesson files only through short-lived signed links issued after an access check', async () => {
    const { owner, communityId, courseId } = await setupCommunity(app);
    const upload = multipart('notes.pdf', 'application/pdf', '%PDF-1.4 test file');
    const res = await app.inject({
      method: 'POST',
      url: `/api/communities/${communityId}/media`,
      payload: upload.payload,
      headers: { ...upload.headers, cookie: owner.cookie! },
    });
    expect(res.statusCode).toBe(200);
    const mediaId = res.json().media.id;

    const learner = await newUser(app);
    const outsider = await newUser(app);
    const outsiderUpload = await app.inject({
      method: 'POST',
      url: `/api/communities/${communityId}/media`,
      payload: upload.payload,
      headers: { ...upload.headers, cookie: outsider.cookie! },
    });
    expect(outsiderUpload.statusCode).toBe(403);

    const withFile = content();
    withFile.modules[0]!.lessons[0] = { ...withFile.modules[0]!.lessons[0]!, attachments: [{ mediaId, name: 'Notes' }] };
    await owner.ok('POST', `/api/courses/${courseId}/draft`);
    await owner.ok('PUT', `/api/courses/${courseId}/draft`, { content: withFile });
    await owner.ok('POST', `/api/courses/${courseId}/publish`);

    expect((await outsider.get(`/api/courses/${courseId}/lessons/l1`)).status).toBe(404);
    await learner.ok('POST', `/api/courses/${courseId}/enroll`);
    const lesson = await learner.ok('GET', `/api/courses/${courseId}/lessons/l1`);
    const url: string = lesson.lesson.attachments[0].url;
    expect(url).toMatch(/^\/media\/.+\?exp=\d+&sig=/);

    const file = await app.inject({ url });
    expect(file.statusCode).toBe(200);
    expect(file.body).toBe('%PDF-1.4 test file');
    expect(file.headers['x-content-type-options']).toBe('nosniff');

    const range = await app.inject({ url, headers: { range: 'bytes=0-3' } });
    expect(range.statusCode).toBe(206);
    expect(range.body).toBe('%PDF');

    const tampered = url.replace(/sig=.{4}/, 'sig=AAAA');
    expect((await app.inject({ url: tampered })).statusCode).toBe(403);
    const expired = `/media/${mediaId}?exp=1&sig=whatever`;
    expect((await app.inject({ url: expired })).statusCode).toBe(403);
  });

  it('rejects disallowed file types and foreign media in lessons', async () => {
    const { owner, communityId, courseId } = await setupCommunity(app);
    const html = multipart('page.html', 'text/html', '<script>alert(1)</script>');
    const res = await app.inject({
      method: 'POST',
      url: `/api/communities/${communityId}/media`,
      payload: html.payload,
      headers: { ...html.headers, cookie: owner.cookie! },
    });
    expect(res.statusCode).toBe(400);

    const other = await setupCommunity(app);
    const pdf = multipart('x.pdf', 'application/pdf', '%PDF');
    const foreign = await app.inject({
      method: 'POST',
      url: `/api/communities/${other.communityId}/media`,
      payload: pdf.payload,
      headers: { ...pdf.headers, cookie: other.owner.cookie! },
    });
    const foreignId = foreign.json().media.id;
    const withForeign = content();
    withForeign.modules[0]!.lessons[0] = { ...withForeign.modules[0]!.lessons[0]!, attachments: [{ mediaId: foreignId, name: 'x' }] };
    await owner.ok('POST', `/api/courses/${courseId}/draft`);
    expect((await owner.put(`/api/courses/${courseId}/draft`, { content: withForeign })).status).toBe(400);
  });

  it('lets learners attach a file to their own submission only', async () => {
    const { courseId } = await setupCommunity(app);
    const learner = await newUser(app);
    const other = await newUser(app);
    await learner.ok('POST', `/api/courses/${courseId}/enroll`);
    await other.ok('POST', `/api/courses/${courseId}/enroll`);
    const pdf = multipart('work.pdf', 'application/pdf', '%PDF learner work');
    const up = await app.inject({
      method: 'POST',
      url: `/api/courses/${courseId}/uploads`,
      payload: pdf.payload,
      headers: { ...pdf.headers, cookie: learner.cookie! },
    });
    expect(up.statusCode).toBe(200);
    const mediaId = up.json().media.id;
    expect((await other.post(`/api/courses/${courseId}/submissions`, { mediaId })).status).toBe(400);
    const ok = await learner.ok('POST', `/api/courses/${courseId}/submissions`, { mediaId });
    expect(ok.submission.attemptNumber).toBe(1);
  });
});
