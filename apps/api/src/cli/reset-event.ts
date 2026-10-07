/**
 * Clears the rehearsal data before the real event (Phase 7). KEEPS: organisers (accounts, authenticators), settings,
 * categories, exhibitors, photos, display tokens and the audit log. DELETES: visitors, votes, one-time-code
 * challenges and the stored demo SMS messages.
 *   pnpm stack:reset-event --confirm=DELETE-ALL-VOTES
 * Refused while voting is OPEN. Writes an audit entry. The API never has the privileges to do this itself (ADR-009);
 * this tool runs as the database owner from the operator container.
 */
import { sql } from 'drizzle-orm';
import { loadEnv } from '../config/env.js';
import { createDb } from '../db/client.js';
import { writeAudit } from '../modules/admin/audit.js';
import { loadSettings } from '../modules/settings/repository.js';
import { votingState } from '../modules/votes/window.js';

const env = loadEnv();
const { pool, db } = createDb(env.DATABASE_URL, 2);

try {
  if (!process.argv.includes('--confirm=DELETE-ALL-VOTES')) {
    console.error('This deletes every visitor and vote. Run again with --confirm=DELETE-ALL-VOTES');
    process.exitCode = 2;
  } else {
    const settings = await loadSettings(db);
    if (votingState(settings) === 'OPEN') {
      console.error('Refused: voting is OPEN. Close voting first (this would erase real votes).');
      process.exitCode = 1;
    } else {
      const counts = await db.transaction(async (tx) => {
        const before = (
          await tx.execute<{ v: number; n: number }>(
            sql`SELECT (SELECT count(*) FROM votes)::int AS n, (SELECT count(*) FROM visitors)::int AS v`,
          )
        ).rows[0]!;
        // The vote and audit triggers refuse deletes by design; this one-off, owner-only transaction steps over them.
        await tx.execute(sql`SET LOCAL session_replication_role = replica`);
        await tx.execute(sql`TRUNCATE votes, otp_challenges, sms_outbox, visitors`);
        await writeAudit(tx, {
          adminId: null,
          label: 'cli:operator',
          action: 'event.reset',
          details: { visitorsRemoved: before.v, votesRemoved: before.n },
        });
        return before;
      });
      console.log(`removed ${counts.v} visitors and ${counts.n} votes.`);
      console.log(
        'Now clear the rate-limit counters:  docker compose restart redis   (or: docker exec mc2026-redis-1 redis-cli flushall)',
      );
    }
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
