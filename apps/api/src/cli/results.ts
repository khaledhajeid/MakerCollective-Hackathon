/**
 * Operator tool for the Blind Hour (ADR-003) — the admin console in Phase 6 drives the same service, and this stays
 * as a break-glass path at the event.
 *   ops:results status
 *   ops:results mode LIVE|FROZEN|HIDDEN|REVEAL
 *   ops:results reveal <category-slug>      (REVEAL mode only)
 * In the Docker stack: pnpm stack:results mode FROZEN
 */
import { RESULTS_VISIBILITY, type ResultsVisibility } from '@mc/shared';
import { loadEnv } from '../config/env.js';
import { createDb } from '../db/client.js';
import { ResultsService } from '../modules/results/service.js';

const actor = { adminId: null, label: 'cli:operator' };
const [cmd, arg] = process.argv.slice(2);

const env = loadEnv();
const { pool, db } = createDb(env.DATABASE_URL, 2);
const results = new ResultsService(db);

try {
  if (cmd === 'status') {
    const frame = await results.frame();
    console.log(`mode: ${frame.mode}   voting: ${frame.voting.state}`);
    if (frame.frozenAt) console.log(`sealed at: ${frame.frozenAt}`);
    for (const c of frame.categories)
      console.log(`  ${c.slug.padEnd(24)} ${c.sealed ? 'sealed' : `${c.total} votes`}`);
  } else if (cmd === 'mode' && arg && (RESULTS_VISIBILITY as readonly string[]).includes(arg)) {
    const r = await results.setMode(arg as ResultsVisibility, actor);
    console.log(
      r.changed ? `results mode is now ${r.mode}` : `already ${r.mode} — nothing changed`,
    );
  } else if (cmd === 'reveal' && arg) {
    const r = await results.revealCategory({ slug: arg }, actor);
    console.log(r.changed ? `revealed ${arg}` : `${arg} was already revealed`);
  } else {
    console.error(
      `usage: results status | mode <${RESULTS_VISIBILITY.join('|')}> | reveal <category-slug>`,
    );
    process.exitCode = 2;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
