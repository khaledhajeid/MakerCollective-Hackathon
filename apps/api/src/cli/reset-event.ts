/**
 * Clears the rehearsal data before the real event (Phase 7). KEEPS: organisers (accounts, authenticators), settings,
 * categories, exhibitors, photos, display tokens and the audit log. DELETES: visitors, votes, one-time-code
 * challenges and the stored demo SMS messages.
 *
 * With --with-content it also DELETES the catalogue (exhibitors, categories, their links and photos) and puts the
 * results display back to LIVE with nothing frozen or revealed, since those refer to the deleted categories. The
 * audit log is never touched.
 *
 *   pnpm stack:reset-event                                    shows what would be deleted (changes nothing)
 *   pnpm stack:reset-event --confirm=DELETE-ALL-VOTES --expect-votes=<N> [--with-content]
 *
 * Two guards against deleting a real event: the number you pass must equal the votes that exist right now (so a
 * command recalled from the shell history after the event fails), and voting must not be OPEN. Both are checked
 * again inside the transaction that deletes, with the settings row locked, so a switch to OPEN in between wins.
 * Writes an audit entry. The API never has the privileges to do this itself (ADR-009); this tool runs as the
 * database owner from the operator container.
 */
import { sql } from 'drizzle-orm';
import { loadEnv } from '../config/env.js';
import { createDb } from '../db/client.js';
import { writeAudit } from '../modules/admin/audit.js';
import { loadSettings } from '../modules/settings/repository.js';
import { votingState } from '../modules/votes/window.js';

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const withContent = process.argv.includes('--with-content');

const countsSql = sql`SELECT (SELECT count(*) FROM votes)::int AS n, (SELECT count(*) FROM visitors)::int AS v,
  (SELECT count(*) FROM exhibitors)::int AS e, (SELECT count(*) FROM categories)::int AS c`;
type Counts = { v: number; n: number; e: number; c: number };

const env = loadEnv();
const { pool, db } = createDb(env.DATABASE_URL, 2);

class Refused extends Error {}

try {
  const settings = await loadSettings(db);
  const now = (await db.execute<Counts>(countsSql)).rows[0]!;
  console.log(
    `${now.v} visitors, ${now.n} votes, ${now.e} exhibitors and ${now.c} categories exist; voting is ${votingState(settings)}.`,
  );

  if (arg('confirm') !== 'DELETE-ALL-VOTES' || arg('expect-votes') === undefined) {
    console.log(
      `To delete the visitors and votes, run again with: --confirm=DELETE-ALL-VOTES --expect-votes=${now.n}\n` +
        `Add --with-content to delete the exhibitors, categories and photos too.\n(nothing was changed)`,
    );
  } else {
    const removed = await db.transaction(async (tx) => {
      // Lock the settings row: nobody can open voting between the check below and the delete.
      await tx.execute(sql`SELECT 1 FROM settings WHERE id = 1 FOR UPDATE`);
      const locked = await loadSettings(tx);
      if (votingState(locked) === 'OPEN')
        throw new Refused(
          'Refused: voting is OPEN. Close voting first (this would erase real votes).',
        );
      const before = (await tx.execute<Counts>(countsSql)).rows[0]!;
      if (Number(arg('expect-votes')) !== before.n)
        throw new Refused(
          `Refused: you expected ${arg('expect-votes')} votes but there are ${before.n}. Run without flags to see the current numbers.`,
        );
      // The vote and audit triggers refuse deletes by design; this one-off, owner-only transaction steps over them.
      await tx.execute(sql`SET LOCAL session_replication_role = replica`);
      // Postgres only truncates a referenced table in the same statement as the tables that reference it, so the
      // catalogue (referenced by the votes) goes in the one statement with them.
      await tx.execute(
        withContent
          ? sql`TRUNCATE votes, otp_challenges, sms_outbox, visitors,
              exhibitor_categories, exhibitors, categories, exhibitor_photos`
          : sql`TRUNCATE votes, otp_challenges, sms_outbox, visitors`,
      );
      if (withContent) {
        // Back to triggers on, so the settings change below tells every API replica and TV at once.
        await tx.execute(sql`SET LOCAL session_replication_role = origin`);
        // Snapshots and the reveal list name categories that no longer exist.
        await tx.execute(
          sql`UPDATE settings SET results_visibility = 'LIVE', frozen_snapshot = NULL, frozen_at = NULL,
              revealed = '[]'::jsonb, version = version + 1, updated_at = now() WHERE id = 1`,
        );
      }
      await writeAudit(tx, {
        adminId: null,
        label: 'cli:operator',
        action: 'event.reset',
        details: {
          visitorsRemoved: before.v,
          votesRemoved: before.n,
          ...(withContent && { exhibitorsRemoved: before.e, categoriesRemoved: before.c }),
        },
      });
      return before;
    });
    console.log(`removed ${removed.v} visitors and ${removed.n} votes.`);
    if (withContent)
      console.log(
        `removed ${removed.e} exhibitors and ${removed.c} categories (with their photos); results display set back to LIVE.`,
      );
    console.log(
      'Now clear the rate-limit counters:  docker exec mc2026-redis-1 redis-cli flushall',
    );
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = err instanceof Refused ? 1 : 2;
} finally {
  await pool.end();
}
