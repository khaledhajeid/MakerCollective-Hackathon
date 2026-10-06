#!/usr/bin/env node
// Builds a throwaway database for browser E2E: real migrations + the dev seed. Refuses anything not named *_e2e.
// Usage: node scripts/e2e-db.mjs   (prints nothing on success; Playwright's globalSetup calls it)
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const envFile = `${root}.env`;
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing (run scripts/gen-env.mjs)');

const url = new URL(process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL);
url.pathname = '/mc_e2e';
const dbName = url.pathname.slice(1);
if (!dbName.endsWith('_e2e')) throw new Error(`Refusing to reset "${dbName}"`);

const pg = createRequire(`${root}apps/api/package.json`)('pg');
const adminUrl = new URL(url);
adminUrl.pathname = '/postgres';
const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();
const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
if (!rowCount) await admin.query(`CREATE DATABASE ${dbName}`);
await admin.end();

const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
await pool.query(
  'DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;',
);
await pool.end();

const run = (script, args = []) => {
  const r = spawnSync(
    'pnpm',
    ['--filter', '@mc/api', 'exec', 'tsx', '--conditions=development', script, ...args],
    {
      cwd: root,
      env: { ...process.env, DATABASE_URL: url.toString(), NODE_ENV: 'development' },
      encoding: 'utf8',
    },
  );
  if (r.status !== 0) throw new Error(`${script} failed:\n${r.stdout}\n${r.stderr}`);
};
run('src/db/migrate.ts');
run('src/db/seed.ts', ['--dev']);
console.log(url.toString());
