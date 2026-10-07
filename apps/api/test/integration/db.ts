import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../../src/db/schema.js';
import { testDatabaseUrl } from './global-setup.js';

export function openTestDb() {
  const pool = new pg.Pool({ connectionString: testDatabaseUrl(), max: 10 });
  const db = drizzle(pool, { schema });
  return {
    pool,
    db,
    /** Wipes data between tests. Test-only: bypasses the append-only/final-vote triggers. */
    async reset() {
      const client = await pool.connect();
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
