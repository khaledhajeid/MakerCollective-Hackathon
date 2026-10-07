// Does NOTIFY-per-commit (the live-results trigger, migration 0006) slow votes down when many commit at once?
// Isolated micro-benchmark with pgbench inside the Postgres container, on a scratch database:
//   same INSERT, same table, same concurrency; one leg also runs pg_notify() before COMMIT.
//   node load/notify-bench.mjs [clients=50] [seconds=15]
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const pw = /^POSTGRES_PASSWORD=(.*)$/m.exec(readFileSync(path.join(root, '.env'), 'utf8'))[1];
const [clients = '50', secs = '15'] = process.argv.slice(2);
const ex = (args, input) =>
  spawnSync('docker', ['exec', '-i', '-e', `PGPASSWORD=${pw}`, 'mc2026-postgres-1', ...args], {
    encoding: 'utf8',
    input,
  });
const psql = (db, sql) => ex(['psql', '-U', 'mc', '-d', db, '-v', 'ON_ERROR_STOP=1', '-c', sql]);

psql('postgres', 'DROP DATABASE IF EXISTS bench WITH (FORCE)');
psql('postgres', 'CREATE DATABASE bench');
psql(
  'bench',
  'CREATE TABLE v (id uuid primary key default gen_random_uuid(), voter int, cat int, at timestamptz default now())',
);

const scripts = {
  plain: 'BEGIN;\nINSERT INTO v (voter, cat) VALUES (:client_id, 1);\nCOMMIT;\n',
  notify:
    "BEGIN;\nINSERT INTO v (voter, cat) VALUES (:client_id, 1);\nSELECT pg_notify('mc_results', 'votes');\nCOMMIT;\n",
};
const out = {};
for (const [name, body] of Object.entries(scripts)) {
  ex(['sh', '-c', `cat > /tmp/${name}.sql`], body);
  // one warm-up, then the measured run
  ex([
    'pgbench',
    '-U',
    'mc',
    '-n',
    '-f',
    `/tmp/${name}.sql`,
    '-c',
    clients,
    '-j',
    '4',
    '-T',
    '3',
    'bench',
  ]);
  const r = ex([
    'pgbench',
    '-U',
    'mc',
    '-n',
    '-r',
    '-f',
    `/tmp/${name}.sql`,
    '-c',
    clients,
    '-j',
    '4',
    '-T',
    secs,
    'bench',
  ]);
  const tps = /tps = ([\d.]+)/.exec(r.stdout)?.[1];
  const lat = /latency average = ([\d.]+) ms/.exec(r.stdout)?.[1];
  out[name] = { tps: Number(tps), avgLatencyMs: Number(lat) };
}
out.overheadPercent = Math.round((1 - out.notify.tps / out.plain.tps) * 1000) / 10;
out.clients = Number(clients);
out.seconds = Number(secs);
console.log(JSON.stringify(out, null, 2));
psql('postgres', 'DROP DATABASE IF EXISTS bench WITH (FORCE)');
