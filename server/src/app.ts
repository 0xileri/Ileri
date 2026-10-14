import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { loadConfig, type Config } from './config';
import type { AppContext } from './context';
import { openDatabase, type Database } from './db';
import { BalanceService } from './chain/balances';
import { HealthTracker } from './chain/health';
import { MockChainReader } from './chain/mockReader';
import { ViemChainReader } from './chain/viemReader';
import type { ChainReader } from './chain/types';
import { LocalStorage } from './media/storage';
import { resolveSession, SESSION_COOKIE, type AuthUser } from './auth/session';
import { AppError } from './lib/errors';
import { authRoutes } from './auth/routes';
import { communityRoutes } from './communities/routes';
import { courseRoutes } from './courses/routes';
import { learningRoutes } from './learning/routes';
import { reviewRoutes } from './reviews/routes';
import { credentialRoutes } from './credentials/routes';
import { rewardRoutes } from './rewards/routes';
import { analyticsRoutes } from './analytics/routes';
import { adminRoutes } from './admin/routes';
import { mediaRoutes } from './media/routes';
import { devRoutes } from './dev/routes';
import { startJobs } from './jobs';

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

export interface BuildOptions {
  config?: Partial<Config>;
  database?: Database;
  chain?: ChainReader;
  logger?: boolean;
}

export async function buildApp(options: BuildOptions = {}): Promise<FastifyInstance> {
  const config = loadConfig(options.config);
  const database = options.database ?? (await openDatabase(config));
  const health = new HealthTracker();
  const chain: ChainReader =
    options.chain ??
    (config.chainMode === 'rpc'
      ? new ViemChainReader(config.rpcUrls, config.chainTimeoutMs)
      : new MockChainReader(database.db));
  const ctx: AppContext = {
    config,
    database,
    db: database.db,
    chain,
    health,
    balances: new BalanceService(
      database.db,
      chain,
      {
        ttlSeconds: config.balanceCacheTtlSeconds,
        graceSeconds: config.balanceStaleGraceSeconds,
        timeoutMs: config.chainTimeoutMs,
      },
      health,
    ),
    storage: new LocalStorage(config.uploadDir),
  };

  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });
  app.decorate('ctx', ctx);
  app.decorateRequest('user', null);

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: config.maxUploadBytes, files: 1, fields: 10 } });
  await app.register(rateLimit, { global: false });

  const unsafe = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  app.addHook('onRequest', async (req) => {
    // SameSite=Lax cookies already block most cross-site writes; this rejects the rest.
    const origin = req.headers.origin;
    if (unsafe.has(req.method) && origin && !config.appOrigins.includes(origin)) {
      throw new AppError(403, 'bad_origin', 'Request origin is not allowed.');
    }
    req.user = await resolveSession(ctx.db, req.cookies[SESSION_COOKIE]);
  });

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.status).send({ error: { code: error.code, message: error.message, details: error.details } });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      const message = status === 429 ? 'Too many requests. Please slow down.' : (error as Error).message;
      return reply.status(status).send({ error: { code: (error as { code?: string }).code ?? 'bad_request', message } });
    }
    req.log.error(error);
    return reply.status(500).send({ error: { code: 'internal', message: 'Something went wrong on our side.' } });
  });

  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(communityRoutes);
      await api.register(courseRoutes);
      await api.register(learningRoutes);
      await api.register(reviewRoutes);
      await api.register(credentialRoutes);
      await api.register(rewardRoutes);
      await api.register(analyticsRoutes);
      await api.register(adminRoutes);
      if (config.devMode) await api.register(devRoutes);
      api.get('/health', async () => ({ ok: await ctx.database.ping() }));
    },
    { prefix: '/api' },
  );
  await app.register(mediaRoutes);

  const indexHtml = path.join(config.webDistDir, 'index.html');
  const hasWeb = fs.existsSync(indexHtml);
  if (hasWeb) {
    await app.register(fastifyStatic, { root: config.webDistDir, wildcard: false, index: false });
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/media/') || req.method !== 'GET' || !hasWeb) {
      return reply.status(404).send({ error: { code: 'not_found', message: 'Not found.' } });
    }
    return reply.type('text/html').sendFile('index.html');
  });

  const stopJobs = config.jobsEnabled && config.env !== 'test' ? startJobs(ctx, app.log) : () => {};
  app.addHook('onClose', async () => {
    stopJobs();
    if (!options.database) await database.close();
  });

  return app;
}
