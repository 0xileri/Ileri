import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from './helpers';

let app: FastifyInstance;
let dist: string;
beforeAll(async () => {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ileri-web-'));
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><div id="root"></div>');
  fs.writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log(1)');
  app = await makeApp({ webDistDir: dist });
});
afterAll(async () => {
  await app.close();
  fs.rmSync(dist, { recursive: true, force: true });
});

describe('web client hosting', () => {
  it('serves the app shell for the root and for client-side routes', async () => {
    for (const url of ['/', '/c/some-community', '/learn/abc/quiz']) {
      const res = await app.inject({ url });
      expect(res.statusCode, url).toBe(200);
      expect(res.body).toContain('id="root"');
    }
  });

  it('serves assets, including files added after startup', async () => {
    expect((await app.inject({ url: '/assets/app.js' })).statusCode).toBe(200);
    fs.writeFileSync(path.join(dist, 'assets', 'later.js'), 'console.log(2)');
    expect((await app.inject({ url: '/assets/later.js' })).statusCode).toBe(200);
  });

  it('sends security headers, with a CSP on the app shell and no caching for the API', async () => {
    const shell = await app.inject({ url: '/' });
    expect(shell.headers['content-security-policy']).toContain("script-src 'self'");
    expect(shell.headers['x-frame-options']).toBe('DENY');
    const api = await app.inject({ url: '/api/config' });
    expect(api.headers['cache-control']).toBe('no-store');
    expect(api.headers['x-content-type-options']).toBe('nosniff');
  });

  it('keeps API and media misses as JSON 404s', async () => {
    const api = await app.inject({ url: '/api/does-not-exist' });
    expect(api.statusCode).toBe(404);
    expect(api.json().error.code).toBe('not_found');
    expect((await app.inject({ method: 'POST', url: '/c/x' })).statusCode).toBe(404);
  });
});
