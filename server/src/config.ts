import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// src/ in development, dist/ when bundled. Both sit directly under server/.
export const SERVER_ROOT = path.resolve(here, '..');

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function int(value: string | undefined, fallback: number): number {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface Config {
  env: 'development' | 'production' | 'test';
  port: number;
  host: string;
  /** Allowed browser origins. The first one is canonical (used in links). */
  appOrigins: string[];
  databaseUrl: string | null;
  /** PGlite data directory when DATABASE_URL is unset. "memory://" keeps it in RAM. */
  pgliteDir: string;
  migrationsDir: string;
  secret: string;
  devMode: boolean;
  chainMode: 'mock' | 'rpc';
  supportedChainIds: number[];
  rpcUrls: Record<number, string>;
  balanceCacheTtlSeconds: number;
  balanceStaleGraceSeconds: number;
  chainTimeoutMs: number;
  platformAdminWallets: string[];
  communityCreation: 'open' | 'admin';
  uploadDir: string;
  maxUploadBytes: number;
  sessionDays: number;
  webDistDir: string;
  jobsEnabled: boolean;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const env = (process.env.NODE_ENV === 'production'
    ? 'production'
    : process.env.NODE_ENV === 'test'
      ? 'test'
      : 'development') as Config['env'];
  const secret = process.env.APP_SECRET ?? '';
  if (env === 'production' && secret.length < 32) {
    throw new Error('APP_SECRET must be set to at least 32 characters in production');
  }
  const supportedChainIds = list(process.env.SUPPORTED_CHAIN_IDS).map(Number).filter(Number.isFinite);
  const chainIds = supportedChainIds.length ? supportedChainIds : [8453];
  const rpcUrls: Record<number, string> = {};
  for (const id of chainIds) {
    const url = process.env[`RPC_URL_${id}`];
    if (url) rpcUrls[id] = url;
  }
  const chainMode = (process.env.CHAIN_MODE ?? (env === 'production' ? 'rpc' : 'mock')) as Config['chainMode'];
  if (chainMode !== 'mock' && chainMode !== 'rpc') throw new Error('CHAIN_MODE must be "mock" or "rpc"');

  const config: Config = {
    env,
    port: int(process.env.PORT, 3000),
    host: process.env.HOST ?? '0.0.0.0',
    appOrigins: list(process.env.APP_ORIGIN).length
      ? list(process.env.APP_ORIGIN)
      : ['http://localhost:5173', 'http://localhost:3000'],
    databaseUrl: process.env.DATABASE_URL || null,
    pgliteDir: process.env.PGLITE_DIR ?? path.join(SERVER_ROOT, 'data', 'pglite'),
    migrationsDir: path.join(SERVER_ROOT, 'drizzle'),
    secret: secret || 'dev-only-secret-change-me-dev-only-secret',
    devMode: bool(process.env.DEV_MODE, env !== 'production'),
    chainMode,
    supportedChainIds: chainIds,
    rpcUrls,
    balanceCacheTtlSeconds: int(process.env.BALANCE_CACHE_TTL_SECONDS, 300),
    balanceStaleGraceSeconds: int(process.env.BALANCE_STALE_GRACE_SECONDS, 3600),
    chainTimeoutMs: int(process.env.CHAIN_TIMEOUT_MS, 5000),
    platformAdminWallets: list(process.env.PLATFORM_ADMIN_WALLETS).map((a) => a.toLowerCase()),
    communityCreation: process.env.COMMUNITY_CREATION === 'admin' ? 'admin' : 'open',
    uploadDir: process.env.UPLOAD_DIR ?? path.join(SERVER_ROOT, 'data', 'uploads'),
    maxUploadBytes: int(process.env.MAX_UPLOAD_MB, 200) * 1024 * 1024,
    sessionDays: int(process.env.SESSION_DAYS, 30),
    webDistDir: process.env.WEB_DIST_DIR ?? path.resolve(SERVER_ROOT, '..', 'web', 'dist'),
    jobsEnabled: bool(process.env.JOBS_ENABLED, true),
    ...overrides,
  };
  if (config.chainMode === 'rpc') {
    for (const id of config.supportedChainIds) {
      if (!config.rpcUrls[id]) throw new Error(`RPC_URL_${id} is required when CHAIN_MODE=rpc`);
    }
  }
  return config;
}
