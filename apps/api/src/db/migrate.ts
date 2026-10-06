import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadEnv } from '../config/env.js';
import { createDb } from './client.js';

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

if (!existsSync(`${migrationsFolder}/meta/_journal.json`)) {
  console.log('no migrations generated yet — nothing to apply');
  process.exit(0);
}

const env = loadEnv();
const { pool, db } = createDb(env.DATABASE_URL, 1);
try {
  await migrate(db, { migrationsFolder });
  console.log('migrations applied');
} finally {
  await pool.end();
}
