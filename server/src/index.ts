import { buildApp } from './app';

const app = await buildApp({ logger: true });
const { port, host, env, chainMode, devMode } = app.ctx.config;

try {
  await app.listen({ port, host });
  app.log.info({ env, chainMode, devMode, database: app.ctx.database.kind }, 'Ileri server ready');
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
