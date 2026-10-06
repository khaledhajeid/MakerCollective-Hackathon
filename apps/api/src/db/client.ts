import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DbHandle {
  pool: pg.Pool;
  db: Database;
}

export function createDb(url: string, max: number): DbHandle {
  const pool = new pg.Pool({
    connectionString: url,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Guard against runaway queries holding connections during an event burst.
    statement_timeout: 10_000,
  });
  return { pool, db: drizzle(pool, { schema }) };
}
