import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadEnv } from '../config/env.js';
import { createDb } from './client.js';
import { APP_ROLE, provisionAppRole } from './provision.js';

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

if (!existsSync(`${migrationsFolder}/meta/_journal.json`)) {
  console.log('no migrations generated yet — nothing to apply');
  process.exit(0);
}

const env = loadEnv();
const { pool, db } = createDb(env.DATABASE_URL, 2);
try {
  await migrate(db, { migrationsFolder });
  console.log('migrations applied');
  if (env.APP_DB_PASSWORD) {
    await provisionAppRole(pool, env.APP_DB_PASSWORD);
    console.log(
      `database role "${APP_ROLE}" provisioned (DML only, no DDL, votes/audit append-only)`,
    );
  } else {
    console.warn('APP_DB_PASSWORD not set: the least-privilege role was NOT provisioned');
  }
} finally {
  await pool.end();
}
