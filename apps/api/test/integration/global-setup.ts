import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { provisionAppRole } from '../../src/db/provision.js';

/**
 * Roles are cluster-wide, so the suite must never touch the real `mc_app` (provisioning resets its password and the
 * running stack would stop authenticating). Same code, a role of its own.
 */
export const TEST_APP_ROLE = 'mc_app_test';

/** Resolves the dedicated test database URL (never the dev/prod database). */
export function testDatabaseUrl(): string {
  const envFile = fileURLToPath(new URL('../../../../.env', import.meta.url));
  if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  if (!process.env.DATABASE_URL)
    throw new Error('Set TEST_DATABASE_URL or DATABASE_URL for integration tests');
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = '/mc_test';
  return url.toString();
}

export default async function setup() {
  const testUrl = testDatabaseUrl();
  // This setup DROPS the schema: refuse anything that is not unmistakably a test database.
  const dbName = new URL(testUrl).pathname.slice(1);
  if (!dbName.endsWith('_test')) throw new Error(`Refusing to reset non-test database "${dbName}"`);
  const admin = new URL(testUrl);
  admin.pathname = '/postgres';

  const adminClient = new pg.Client({ connectionString: admin.toString() });
  await adminClient.connect();
  const { rowCount } = await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [
    'mc_test',
  ]);
  if (!rowCount) await adminClient.query('CREATE DATABASE mc_test');
  await adminClient.end();

  // Fresh schema every run, built by the REAL migrations (tests prove what production gets).
  const pool = new pg.Pool({ connectionString: testUrl, max: 1 });
  await pool.query(
    'DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;',
  );
  await migrate(drizzle(pool), {
    migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
  });
  // The API under test connects as the least-privilege role, exactly as in production (ADR-009): the whole
  // integration suite therefore proves the application never needs more than DML on the allow-listed tables.
  const appPassword = `t-${randomBytes(24).toString('hex')}`;
  await provisionAppRole(pool, appPassword, TEST_APP_ROLE);
  await pool.end();

  const appUrl = new URL(testUrl);
  appUrl.username = TEST_APP_ROLE;
  appUrl.password = appPassword;
  process.env.TEST_APP_DATABASE_URL = appUrl.toString();
  process.env.TEST_DATABASE_URL = testUrl;
}
