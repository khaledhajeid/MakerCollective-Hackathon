/**
 * Pre-event readiness report (Phase 7). Read-only.
 *   pnpm stack:preflight            full report (also asks the public hostname for /api/healthz)
 *   pnpm stack:preflight --offline  skips the checks that need the internet
 * Exit code 1 when something must be fixed before the doors open.
 */
import pg from 'pg';
import { loadEnv } from '../config/env.js';
import { createDb } from '../db/client.js';
import { APP_ROLE, connectedAsPrivilegedRole } from '../db/provision.js';
import { SEED_EXHIBITORS } from '../db/seed-data.js';
import { createRedis } from '../lib/redis.js';
import { evaluate, exitCode, type Snapshot } from '../ops/preflight.js';
import { votingState } from '../modules/votes/window.js';

const offline = process.argv.includes('--offline');

// A configuration the API itself would refuse to boot with is the most basic failure of all: report it as one.
let env: ReturnType<typeof loadEnv>;
try {
  env = loadEnv();
} catch (err) {
  console.log(`\n[ FAIL ] Configuration             ${err instanceof Error ? err.message : err}\n`);
  console.log('NOT READY: fix the environment above (see .env), then run this again.\n');
  process.exit(1);
}
const { pool } = createDb(env.DATABASE_URL, 2);
const one = async <T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T> => (await pool.query<T>(sql, params)).rows[0]!;

async function appRoleStatus(): Promise<Snapshot['appRole']> {
  const password = process.env.APP_DB_PASSWORD;
  if (!password) return 'unchecked';
  const url = new URL(env.DATABASE_URL);
  url.username = APP_ROLE;
  url.password = password;
  const app = new pg.Pool({
    connectionString: url.toString(),
    max: 1,
    connectionTimeoutMillis: 4000,
  });
  try {
    return (await connectedAsPrivilegedRole(app)) ? 'privileged' : 'ok';
  } catch {
    return 'cannot-connect';
  } finally {
    await app.end().catch(() => undefined);
  }
}

async function redisStatus(): Promise<Snapshot['redis']> {
  const redis = createRedis(env.REDIS_URL);
  if (!redis) return 'disabled';
  try {
    await redis.connect();
    await redis.ping();
    return 'up';
  } catch {
    return 'down';
  } finally {
    redis.disconnect();
  }
}

async function publicChecks(): Promise<
  Pick<Snapshot, 'publicHealth' | 'readyzBlocked' | 'analyticsBeacon'>
> {
  if (offline) return { publicHealth: 'skipped', readyzBlocked: null, analyticsBeacon: null };
  const base = env.PUBLIC_ORIGIN.replace(/\/$/, '');
  const get = (path: string) => fetch(base + path, { signal: AbortSignal.timeout(6000) });
  try {
    const health = await get('/api/healthz');
    // An error page from the tunnel (530, 502…) says nothing about our edge: judge the rest only when it answers.
    if (!health.ok)
      return { publicHealth: 'unreachable', readyzBlocked: null, analyticsBeacon: null };
    const ready = await get('/api/readyz');
    const html = await (await get('/')).text();
    return {
      publicHealth: 'ok',
      readyzBlocked: ready.status === 404,
      analyticsBeacon: /cloudflareinsights\.com/i.test(html),
    };
  } catch {
    return { publicHealth: 'unreachable', readyzBlocked: null, analyticsBeacon: null };
  }
}

try {
  const s = await one<{
    access_mode: 'IP_ALLOWLIST' | 'OFF';
    cidrs: string[];
    voting_status: 'OPEN' | 'CLOSED' | 'SCHEDULED';
    voting_opens_at: Date | null;
    voting_closes_at: Date | null;
    results_visibility: string;
    wifi_ssid: string | null;
    wifi_password: string | null;
  }>(
    `SELECT access_mode, venue_cidrs::text[] AS cidrs, voting_status, voting_opens_at, voting_closes_at,
            results_visibility, wifi_ssid, wifi_password FROM settings WHERE id = 1`,
  );
  const admins = await one<{ ready: number; pending: number }>(
    `SELECT count(*) FILTER (WHERE role = 'SUPER_ADMIN' AND mfa_enabled AND NOT is_disabled AND NOT must_change_password)::int AS ready,
            count(*) FILTER (WHERE NOT is_disabled AND (must_change_password OR NOT mfa_enabled))::int AS pending
       FROM admin_users`,
  );
  const cats = await pool.query<{ name: string; n: number }>(
    `SELECT c.name_en AS name, count(e.id) FILTER (WHERE e.is_active)::int AS n
       FROM categories c
       LEFT JOIN exhibitor_categories ec ON ec.category_id = c.id
       LEFT JOIN exhibitors e ON e.id = ec.exhibitor_id
      WHERE c.is_active GROUP BY c.id, c.name_en`,
  );
  const ex = await one<{ nophoto: number; demo: number }>(
    `SELECT count(*) FILTER (WHERE photo_key IS NULL)::int AS nophoto,
            count(*) FILTER (WHERE name_en = ANY($1::text[]))::int AS demo
       FROM exhibitors WHERE is_active`,
    [SEED_EXHIBITORS.map((e) => e.nameEn)],
  );
  const displays = await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM display_tokens WHERE revoked_at IS NULL`,
  );
  const data = await one<{ visitors: number; votes: number; sms: number }>(
    `SELECT (SELECT count(*) FROM visitors)::int AS visitors, (SELECT count(*) FROM votes)::int AS votes,
            (SELECT count(*) FROM sms_outbox)::int AS sms`,
  );

  const snapshot: Snapshot = {
    env: {
      nodeEnv: env.NODE_ENV,
      smsProvider: env.SMS_PROVIDER,
      demoMode: env.DEMO_MODE,
      publicOrigin: env.PUBLIC_ORIGIN,
    },
    settings: {
      accessMode: s.access_mode,
      venueCidrs: s.cidrs,
      votingState: votingState({
        votingStatus: s.voting_status,
        votingOpensAt: s.voting_opens_at,
        votingClosesAt: s.voting_closes_at,
      }),
      votingClosesAt: s.voting_closes_at,
      resultsVisibility: s.results_visibility,
      wifiSsid: s.wifi_ssid,
      hasWifiPassword: !!s.wifi_password,
    },
    admins: { superAdminsReady: admins.ready, pendingSetup: admins.pending },
    catalog: {
      activeCategories: cats.rows.length,
      emptyCategories: cats.rows.filter((r) => r.n === 0).map((r) => r.name),
      thinCategories: cats.rows.filter((r) => r.n === 1).map((r) => r.name),
      exhibitorsWithoutPhoto: ex.nophoto,
      demoNamedExhibitors: ex.demo,
    },
    displays: { active: displays.n },
    testData: { visitors: data.visitors, votes: data.votes, smsOutbox: data.sms },
    redis: await redisStatus(),
    appRole: await appRoleStatus(),
    ...(await publicChecks()),
  };

  const checks = evaluate(snapshot);
  const mark = { pass: '  ok  ', warn: ' WARN ', fail: ' FAIL ' } as const;
  console.log(`\nMC2026 pre-event check — ${new Date().toISOString()}\n`);
  for (const k of checks) console.log(`[${mark[k.level]}] ${k.title.padEnd(26)} ${k.detail}`);
  const n = (l: string) => checks.filter((k) => k.level === l).length;
  console.log(`\n${n('pass')} ok, ${n('warn')} warnings, ${n('fail')} failures\n`);
  if (exitCode(checks)) console.log('NOT READY: fix the FAIL lines above, then run this again.\n');
  process.exitCode = exitCode(checks);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
