import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { buildApp } from '../src/app';
import type { Config } from '../src/config';
import { ApiClient } from '../src/dev/client';
import type { CourseContentInput } from '../../shared/src/content';

export { ApiClient };

/**
 * Embedded PGlite by default. Set TEST_DATABASE_URL to run against real Postgres:
 * each app gets its own throwaway database, created here and dropped on close.
 */
async function testDatabase(): Promise<{ databaseUrl: string | null; drop: () => Promise<void> }> {
  const adminUrl = process.env.TEST_DATABASE_URL;
  if (!adminUrl) return { databaseUrl: null, drop: async () => {} };
  const { default: pg } = await import('pg');
  const name = `ileri_test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return {
    databaseUrl: url.toString(),
    drop: async () => {
      const client = new pg.Client({ connectionString: adminUrl });
      await client.connect();
      await client.query(`drop database if exists ${name} with (force)`);
      await client.end();
    },
  };
}

export async function makeApp(config: Partial<Config> = {}): Promise<FastifyInstance> {
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ileri-test-'));
  const database = await testDatabase();
  const app = await buildApp({
    config: {
      env: 'test',
      pgliteDir: 'memory://',
      databaseUrl: database.databaseUrl,
      uploadDir,
      devMode: true,
      chainMode: 'mock',
      balanceCacheTtlSeconds: 0,
      balanceStaleGraceSeconds: 0,
      jobsEnabled: false,
      ...config,
    },
  });
  app.addHook('onClose', async () => {
    fs.rmSync(uploadDir, { recursive: true, force: true });
    // Close the pool before dropping its database; closing is idempotent.
    await app.ctx.database.close();
    await database.drop();
  });
  return app;
}

export function newKey() {
  const key = generatePrivateKey();
  return { key, address: privateKeyToAccount(key).address.toLowerCase() };
}

export async function newUser(app: FastifyInstance, name?: string) {
  const { key, address } = newKey();
  const client = await ApiClient.signIn(app, key);
  if (name) await client.ok('PATCH', '/api/me', { displayName: name });
  return Object.assign(client, { key, walletAddress: address });
}

export const PASS = { chainId: 8453, contract: '0x000000000000000000000000000000000000c0de' };

export async function giveToken(client: ApiClient, owner: string, balance = '1', overrides: Record<string, unknown> = {}) {
  await client.ok('PUT', '/api/dev/balances', {
    owner,
    chainId: PASS.chainId,
    standard: 'erc721',
    contract: PASS.contract,
    balance,
    ...overrides,
  });
}

export function content(overrides: Partial<CourseContentInput> = {}): CourseContentInput {
  return {
    description: 'Test course',
    modules: [
      {
        id: 'm1',
        title: 'Module',
        lessons: [
          { id: 'l1', title: 'Lesson one', kind: 'text', body: 'Body one' },
          { id: 'l2', title: 'Lesson two', kind: 'text', body: 'Body two' },
        ],
      },
    ],
    quiz: {
      id: 'qz',
      title: 'Quiz',
      passPercent: 100,
      questionsPerAttempt: 2,
      maxAttempts: 2,
      questions: [
        { id: 'q1', prompt: 'Q1', kind: 'single', options: [{ id: 'a', text: 'A', correct: true }, { id: 'b', text: 'B', correct: false }] },
        { id: 'q2', prompt: 'Q2', kind: 'multiple', options: [{ id: 'a', text: 'A', correct: true }, { id: 'b', text: 'B', correct: true }, { id: 'c', text: 'C', correct: false }] },
        { id: 'q3', prompt: 'Q3', kind: 'single', options: [{ id: 'a', text: 'A', correct: false }, { id: 'b', text: 'B', correct: true }] },
      ],
    },
    assignment: {
      id: 'as',
      title: 'Assignment',
      prompt: 'Do the thing',
      rubric: [
        { id: 'r1', title: 'Required criterion', required: true },
        { id: 'r2', title: 'Optional criterion', required: false },
      ],
    },
    completion: { requireAllLessons: true, requireQuiz: true, requireAssignment: true },
    credential: { enabled: true, title: 'Test credential', criteria: '' },
    ...overrides,
  };
}

export const CORRECT: Record<string, string[]> = { q1: ['a'], q2: ['a', 'b'], q3: ['b'] };

/** Owner + published course. Returns ids and clients. */
export async function setupCommunity(app: FastifyInstance, opts: { joinPolicy?: unknown; content?: CourseContentInput } = {}) {
  const owner = await newUser(app, 'Owner');
  const { community } = await owner.ok('POST', '/api/communities', { name: `Community ${Math.random().toString(36).slice(2, 8)}` });
  if (opts.joinPolicy !== undefined) await owner.ok('PATCH', `/api/communities/${community.id}`, { joinPolicy: opts.joinPolicy });
  const { course } = await owner.ok('POST', `/api/communities/${community.id}/courses`, { title: 'Course' });
  await owner.ok('PUT', `/api/courses/${course.id}/draft`, { content: opts.content ?? content() });
  await owner.ok('POST', `/api/courses/${course.id}/publish`);
  return { owner, communityId: community.id as string, courseId: course.id as string };
}

export async function passQuiz(client: ApiClient, courseId: string, answers = CORRECT) {
  const { attempt } = await client.ok('POST', `/api/courses/${courseId}/quiz/attempts`);
  const picked = Object.fromEntries(attempt.questions.map((q: { id: string }) => [q.id, answers[q.id] ?? []]));
  return client.ok('POST', `/api/quiz-attempts/${attempt.id}/submit`, { answers: picked });
}

export async function finishLessons(client: ApiClient, courseId: string, ids = ['l1', 'l2']) {
  for (const id of ids) await client.ok('POST', `/api/courses/${courseId}/lessons/${id}/complete`);
}
