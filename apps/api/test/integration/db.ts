import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../../src/db/schema.js';
import { testDatabaseUrl } from './global-setup.js';

/**
 * `pool`/`db` connect as the least-privilege application role (what production uses); `owner` is the schema
 * owner, for test set-up that the application itself must never be able to do.
 */
export function openTestDb() {
  const pool = new pg.Pool({
    connectionString: process.env.TEST_APP_DATABASE_URL ?? testDatabaseUrl(),
    max: 10,
  });
  const owner = new pg.Pool({ connectionString: testDatabaseUrl(), max: 2 });
  const db = drizzle(pool, { schema });
  // Test files end `pool`; the owner pool goes with it.
  const endApp = pool.end.bind(pool) as () => Promise<void>;
  pool.end = (async () => {
    await owner.end();
    await endApp();
  }) as typeof pool.end;
  return {
    pool,
    owner,
    db,
    /** Owner-level handle, for tests of the trigger layer (which must hold even against a privileged connection). */
    ownerDb: drizzle(owner, { schema }),
    /** Wipes data between tests. Test-only: bypasses the append-only/final-vote triggers. */
    async reset() {
      const client = await owner.connect();
      try {
        // SET LOCAL is transaction-scoped: even if TRUNCATE fails, triggers are restored on ROLLBACK.
        await client.query('BEGIN');
        await client.query('SET LOCAL session_replication_role = replica');
        await client.query(`TRUNCATE votes, exhibitor_categories, exhibitors, exhibitor_photos, categories, otp_challenges, visitors,
                 sms_outbox, admin_sessions, admin_recovery_codes, display_tokens, audit_log, admin_users`);
        await client.query('DELETE FROM settings');
        await client.query('INSERT INTO settings (id) VALUES (1)');
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
