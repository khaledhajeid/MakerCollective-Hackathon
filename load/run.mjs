// One command per load-test scenario. See load/README.md.
//   node load/run.mjs smoke|event|stress|chaos [--chaos]
// Runs against a throw-away database (mc_load) so the real data is never touched, then puts the stack back.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const [scenario = 'smoke', ...flags] = process.argv.slice(2);
const chaos = flags.includes('--chaos') || scenario === 'chaos';
const SCEN = {
  smoke: { vus: 50, arrive: 20, think: 0, tvSecs: 90 },
  event: { vus: 1000, arrive: 300, think: 1, tvSecs: 480 }, // the plan's worst case: everyone within 5 minutes
  chaos: { vus: 1000, arrive: 180, think: 1, tvSecs: 360 }, // a faster crowd; each replica is killed in turn
  stress: { vus: 1000, arrive: 30, think: 0, tvSecs: 240 }, // 10x that arrival rate, no human pauses
}[scenario];
if (!SCEN) throw new Error('scenario: smoke | event | stress');

const env = Object.fromEntries(
  readFileSync(path.join(root, '.env'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const out = path.join(
  root,
  'load/results',
  `${scenario}${flags.includes('--chaos') ? '-chaos' : ''}`,
);
mkdirSync(out, { recursive: true });
for (const f of ['otp-feed.log', 'tv.log', 'k6.log']) writeFileSync(path.join(out, f), '');

// A null value REMOVES the variable (an empty string would still override .env).
const sh = (cmd, args, opts = {}) => {
  const e = { ...process.env, ...opts.env };
  for (const k of Object.keys(e)) if (e[k] === null) delete e[k];
  return spawnSync(cmd, args, { cwd: root, encoding: 'utf8', ...opts, env: e });
};
const compose = (envx, ...args) =>
  sh(
    'docker',
    [
      'compose',
      '--env-file',
      '.env',
      '-f',
      'infra/docker-compose.yml',
      '--profile',
      'full',
      ...args,
    ],
    { env: envx },
  );
const psql = (db, sql) =>
  sh('docker', [
    'exec',
    '-e',
    `PGPASSWORD=${env.POSTGRES_PASSWORD}`,
    'mc2026-postgres-1',
    'psql',
    '-U',
    'mc',
    '-d',
    db,
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    sql,
  ]);
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
// Overrides for the load stack only (shell variables beat .env in compose): the demo SMS inbox, so k6 can read
// the one-time codes, and plain http locally because the session cookie is Secure on the real https origin.
const LOADDB = {
  STACK_DB: 'mc_load',
  STACK_PUBLIC_ORIGIN: 'http://localhost:8080',
  SMS_PROVIDER: 'demo-inbox',
  DEMO_MODE: 'true',
};
const RESTORE = Object.fromEntries(Object.keys(LOADDB).map((k) => [k, null]));

const children = [];
let stats = null;
let failed = true;

try {
  log(`scenario ${scenario}${chaos ? ' + chaos' : ''}: ${SCEN.vus} visitors over ${SCEN.arrive}s`);
  psql('postgres', 'DROP DATABASE IF EXISTS mc_load WITH (FORCE)');
  psql('postgres', 'CREATE DATABASE mc_load');
  sh('docker', ['exec', 'mc2026-redis-1', 'redis-cli', 'flushall']);
  log('starting the stack on mc_load');
  let r = compose(
    LOADDB,
    'up',
    '-d',
    '--build',
    '--force-recreate',
    'migrate',
    'api1',
    'api2',
    'caddy',
  );
  if (r.status) throw new Error(r.stderr);
  r = compose(LOADDB, 'run', '--rm', 'migrate', 'node', 'dist/db/seed.js', '--dev');
  if (r.status) throw new Error(r.stderr + r.stdout);

  // 20 TV tokens
  const tokens = [];
  for (let i = 1; i <= 20; i++) {
    const o = compose(
      LOADDB,
      'run',
      '--rm',
      'migrate',
      'node',
      'dist/cli/display.js',
      'create',
      `Load TV ${i}`,
    );
    const t = /#t=([A-Za-z0-9_-]+)/.exec(o.stdout)?.[1];
    if (!t) throw new Error('no display token: ' + o.stdout + o.stderr);
    tokens.push(t);
  }
  writeFileSync(path.join(out, 'tokens.tmp.json'), JSON.stringify(tokens));

  for (let i = 0; i < 30; i++) {
    const h = sh('curl', ['-fs', 'http://127.0.0.1:8080/api/healthz']);
    if (h.status === 0) break;
    await sleep(1000);
  }

  const hostDb = `postgres://mc:${env.POSTGRES_PASSWORD}@127.0.0.1:55432/mc_load`;
  const spawnChild = (cmd, args, envx = {}, file) => {
    const c = spawn(cmd, args, {
      cwd: root,
      env: { ...process.env, ...envx },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (file) {
      c.stdout.on('data', (d) => appendFileSync(file, d));
      c.stderr.on('data', (d) => appendFileSync(file, d));
    }
    children.push(c);
    return c;
  };
  spawnChild(
    'node',
    ['load/otp-feed.mjs'],
    { DATABASE_URL: hostDb, PORT: '8099' },
    path.join(out, 'otp-feed.log'),
  );
  await sleep(1000);
  const tv = spawnChild(
    'node',
    [
      'load/tv-probe.mjs',
      'http://127.0.0.1:8080',
      path.join(out, 'tokens.tmp.json'),
      String(SCEN.tvSecs),
      path.join(out, 'tv.json'),
    ],
    {},
    path.join(out, 'tv.log'),
  );
  await sleep(3000);

  // container CPU / memory every 5 s
  stats = spawn('sh', [
    '-c',
    `while true; do docker stats --no-stream --format '{{json .}}' mc2026-api1-1 mc2026-api2-1 mc2026-caddy-1 mc2026-postgres-1 mc2026-redis-1 | sed "s/^/$(date +%s) /" >> ${path.join(out, 'stats.ndjson')}; sleep 5; done`,
  ]);
  writeFileSync(path.join(out, 'stats.ndjson'), '');

  const k6 = spawnChild(
    'docker',
    [
      'run',
      '--rm',
      '--name',
      'mc2026-k6',
      '--network',
      'mc2026_backend',
      '--add-host',
      'host.docker.internal:host-gateway',
      '-v',
      `${path.join(root, 'load')}:/scripts:ro`,
      '-v',
      `${out}:/results`,
      '-e',
      `RUN_ID=${(Date.now() % 90) + 1}`,
      '-e',
      `VUS=${SCEN.vus}`,
      '-e',
      `ARRIVE_SEC=${SCEN.arrive}`,
      '-e',
      `THINK=${SCEN.think}`,
      'grafana/k6:latest',
      'run',
      '--out',
      'json=/results/points.json',
      '/scripts/voter-flow.js',
    ],
    {},
    path.join(out, 'k6.log'),
  );
  const k6done = new Promise((res) => k6.on('exit', res));

  const timeline = [];
  const mark = (what) => {
    timeline.push({ t: Math.round((Date.now() - t0) / 1000), what });
    log(what);
  };
  const t0 = Date.now();
  if (chaos) {
    // One failure at a time, like a real incident: kill a replica, leave it down 40 s, start it, wait until it is
    // healthy again, then (10 s later) do the same to the other one.
    const healthy = async (name) => {
      for (let i = 0; i < 90; i++) {
        const r = sh('docker', ['inspect', '-f', '{{.State.Health.Status}}', name]);
        if (r.stdout.trim() === 'healthy') return;
        await sleep(1000);
      }
    };
    await sleep(Math.max(0, SCEN.arrive * 0.25 * 1000 - (Date.now() - t0)));
    for (const n of ['api1', 'api2']) {
      const c = `mc2026-${n}-1`;
      mark(`KILL ${n}`);
      sh('docker', ['kill', c]);
      await sleep(40000);
      mark(`START ${n}`);
      sh('docker', ['start', c]);
      await healthy(c);
      mark(`${n} healthy`);
      await sleep(10000);
    }
  }
  await k6done;
  mark('k6 finished');
  await sleep(8000); // let the TVs catch up and the last frames land
  await new Promise((res) => (tv.exitCode !== null ? res() : tv.on('exit', res)));
  stats.kill();
  spawnSync('pkill', ['-f', 'docker stats --no-stream']);
  for (const c of children) c.kill();
  writeFileSync(path.join(out, 'timeline.json'), JSON.stringify(timeline, null, 1));
  sh('rm', ['-f', path.join(out, 'tokens.tmp.json')]);

  const v = sh('node', ['load/verify.mjs', path.join(out, 'summary.json')], {
    env: { DATABASE_URL: hostDb },
  });
  writeFileSync(path.join(out, 'verify.json'), v.stdout);
  console.log(v.stdout || v.stderr);

  failed = false;
} finally {
  // Whatever happened above, never leave the real hostname on the demo build / throw-away database.
  stats?.kill();
  spawnSync('pkill', ['-f', 'docker stats --no-stream']);
  for (const c of children) c.kill();
  spawnSync('docker', ['rm', '-f', 'mc2026-k6']);
  if (failed) console.error('run FAILED, restoring the real stack');
  log('putting the real stack back');
  compose(RESTORE, 'up', '-d', '--force-recreate', 'migrate', 'api1', 'api2', 'caddy');
}
