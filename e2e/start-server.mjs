// Starts the built server on a fresh embedded database with demo data, for e2e runs.
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ileri-e2e-'));
const env = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: '3100',
  APP_ORIGIN: 'http://localhost:3100',
  PGLITE_DIR: path.join(dir, 'db'),
  UPLOAD_DIR: path.join(dir, 'uploads'),
  JOBS_ENABLED: 'false',
};
const seed = spawnSync('npx', ['tsx', 'src/seed.ts'], { cwd: 'server', env, stdio: 'inherit' });
if (seed.status !== 0) process.exit(seed.status ?? 1);
const server = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env, stdio: 'inherit' });
const stop = () => {
  server.kill('SIGTERM');
  fs.rmSync(dir, { recursive: true, force: true });
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
server.on('exit', (code) => process.exit(code ?? 0));
