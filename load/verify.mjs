// After a run: does the database agree with what the visitors were told?
//   DATABASE_URL=… node load/verify.mjs <summary.json> [expectedVotersPrefix]
// Checks: (1) every vote k6 saw confirmed exists exactly once (idempotent retries created no duplicates),
//         (2) nobody has two votes in one category, (3) the per-category totals add up to the vote count.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const pg = require('pg');

const summary = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const confirmed = summary.metrics.votes_confirmed?.values.count ?? 0;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const q = async (s) => (await pool.query(s)).rows;

const [{ votes }] = await q('select count(*)::int votes from votes');
const [{ visitors }] = await q('select count(*)::int visitors from visitors');
const [{ dup }] = await q(
  'select count(*)::int dup from (select visitor_id, category_id from votes group by 1,2 having count(*) > 1) d',
);
const perCat = await q('select category_id, count(*)::int n from votes group by 1');
const sumCat = perCat.reduce((a, r) => a + r.n, 0);

// Commit time of every 50th vote, so the report can say how long a vote took to appear on the TVs.
const voteTimes = Object.fromEntries(
  (
    await q(
      `select n, (extract(epoch from at) * 1000)::bigint::text as ms from
         (select row_number() over (order by created_at) n, created_at at from votes) t where n % 50 = 0`,
    )
  ).map((r) => [r.n, Number(r.ms)]),
);

const out = {
  confirmedByVisitors: confirmed,
  votesInDatabase: votes,
  visitorsInDatabase: visitors,
  duplicateVotes: dup,
  categoryTotalsMatch: sumCat === votes,
  allConfirmedPersisted: votes >= confirmed,
  lostVotes: Math.max(0, confirmed - votes),
  voteTimes,
};
console.log(JSON.stringify(out, null, 2));
await pool.end();
if (out.duplicateVotes || out.lostVotes || !out.categoryTotalsMatch) process.exit(1);
