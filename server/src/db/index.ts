import fs from 'node:fs';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import * as schema from './schema';
import type { Config } from '../config';

export type Schema = typeof schema;
/** Works for both the pooled Postgres client and a transaction handle. */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

export interface Database {
  db: Db;
  kind: 'postgres' | 'pglite';
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export async function openDatabase(config: Pick<Config, 'databaseUrl' | 'pgliteDir' | 'migrationsDir'>): Promise<Database> {
  if (config.databaseUrl) {
    const { default: pg } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: config.migrationsDir });
    return {
      db: db as unknown as Db,
      kind: 'postgres',
      ping: () => ping(db as unknown as Db),
      close: () => pool.end(),
    };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  if (!config.pgliteDir.startsWith('memory://')) fs.mkdirSync(config.pgliteDir, { recursive: true });
  const client = new PGlite(config.pgliteDir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: config.migrationsDir });
  return {
    db: db as unknown as Db,
    kind: 'pglite',
    ping: () => ping(db as unknown as Db),
    close: () => client.close(),
  };
}

async function ping(db: Db): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
