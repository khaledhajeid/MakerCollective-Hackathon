import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ResultsFrameSchema, type ResultsFrame } from '@mc/shared';
import { buildApp } from '../../src/app.js';
import {
  auditLog,
  categories,
  exhibitorCategories,
  exhibitors,
  settings,
  visitors,
  votes,
} from '../../src/db/schema.js';
import { testEnv } from '../helpers.js';
import { openTestDb } from './db.js';
import { testDatabaseUrl } from './global-setup.js';

const { pool, db, reset } = openTestDb();
afterAll(() => pool.end());

const operator = { adminId: null, label: 'test:operator' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ───────────── a minimal SSE client over real HTTP ───────────── */

interface Evt {
  event: string;
  data: string;
}
function openStream(port: number, cookie?: string) {
  const controller = new AbortController();
  const events: Evt[] = [];
  let raw = '';
  let status = 0;
  let ended = false;
  const ready = fetch(`http://127.0.0.1:${port}/api/display/stream`, {
    headers: cookie ? { cookie } : {},
    signal: controller.signal,
  }).then(async (res) => {
    status = res.status;
    if (!res.body) return;
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = dec.decode(value, { stream: true });
        raw += text;
        buf += text;
        let i;
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const event = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (event && data !== undefined) events.push({ event, data });
        }
      }
    } catch {
      /* aborted */
    }
    ended = true;
  });
  const frames = () =>
    events
      .filter((e) => e.event === 'frame')
      .map((e) => ResultsFrameSchema.parse(JSON.parse(e.data)));
  return {
    ready,
    events,
    frames,
    get status() {
      return status;
    },
    get raw() {
      return raw;
    },
    get ended() {
      return ended;
    },
    close: () => controller.abort(),
    /** Waits until a frame satisfying `pred` has been received (checks frames already received first). */
    async frameWhere(pred: (f: ResultsFrame) => boolean, timeoutMs = 3000): Promise<ResultsFrame> {
      const start = Date.now();
      for (;;) {
        const hit = frames().find(pred);
        if (hit) return hit;
        if (Date.now() - start > timeoutMs)
          throw new Error(
            `no matching frame; got ${JSON.stringify(frames().map((f) => [f.mode, f.totalVotes]))}`,
          );
        await sleep(10);
      }
    },
  };
}

/* ───────────── fixtures ───────────── */

interface Booted {
  app: Awaited<ReturnType<typeof buildApp>>;
  port: number;
}
let apps: Booted[] = [];
async function boot(hub: Record<string, number> = {}): Promise<Booted> {
  const env = testEnv({ DATABASE_URL: testDatabaseUrl() });
  const app = await buildApp(
    {
      env,
      db,
      redis: null,
      resultsHub: { minIntervalMs: 40, resyncMs: 60_000, heartbeatMs: 120, freshMs: 15, ...hub },
    },
    // HTTP clients open spare connections that never carry a request; Node does not count those as idle.
    { forceCloseConnections: true },
  );
  await app.listen({ host: '127.0.0.1', port: 0 });
  await app.resultsHub.start();
  const port = (app.server.address() as { port: number }).port;
  const result = { app, port };
  apps.push(result);
  return result;
}

async function seed() {
  const [a, b] = await db
    .insert(categories)
    .values([
      { slug: 'robots', nameEn: 'Robots', nameAr: 'روبوتات', sortOrder: 0 },
      { slug: 'apps', nameEn: 'Apps', nameAr: 'تطبيقات', sortOrder: 1 },
    ])
    .returning();
  const [x, y, z] = await db
    .insert(exhibitors)
    .values([{ nameEn: 'Xavier' }, { nameEn: 'Yara' }, { nameEn: 'Zaid' }])
    .returning();
  await db.insert(exhibitorCategories).values([
    { exhibitorId: x!.id, categoryId: a!.id },
    { exhibitorId: y!.id, categoryId: a!.id },
    { exhibitorId: z!.id, categoryId: b!.id },
  ]);
  return { a: a!, b: b!, x: x!, y: y!, z: z! };
}

let visitorSeq = 0;
async function castVotes(categoryId: string, exhibitorId: string, n: number) {
  for (let i = 0; i < n; i++) {
    const [v] = await db
      .insert(visitors)
      .values({
        nameEnc: 'x',
        phoneEnc: 'x',
        phoneHash: (++visitorSeq).toString(16).padStart(64, '0'),
        voteConsentAt: new Date(),
        consentVersion: 'v',
      })
      .returning({ id: visitors.id });
    await db.insert(votes).values({ visitorId: v!.id, categoryId, exhibitorId });
  }
}

/** Creates a display token through the service and pairs it over HTTP, returning the cookie header. */
async function pair(app: Booted) {
  const { token, id } = await app.app.displays.create('Main hall', operator);
  const res = await fetch(`http://127.0.0.1:${app.port}/api/display/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('mc_display='))!;
  return { cookie: cookie.split(';')[0]!, id, token, setCookie: cookie };
}

beforeEach(async () => {
  await reset();
  await db.update(settings).set({ votingStatus: 'OPEN' });
});
afterEach(async () => {
  await Promise.all(apps.map((a) => a.app.close()));
  apps = [];
});

/* ───────────── tests ───────────── */

describe('display pairing and authentication', () => {
  it('refuses a stream and a session without a paired display', async () => {
    const t = await boot();
    const s = openStream(t.port);
    await s.ready;
    expect(s.status).toBe(401);
    const r = await fetch(`http://127.0.0.1:${t.port}/api/display/session`);
    expect(r.status).toBe(401);
  });

  it('rejects wrong, malformed and revoked tokens; accepts a real one with a hardened cookie', async () => {
    const t = await boot();
    const post = (token: string) =>
      fetch(`http://127.0.0.1:${t.port}/api/display/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
    expect((await post('mcd_' + 'A'.repeat(43))).status).toBe(401);
    expect((await post('not-a-token-but-long-enough-xx')).status).toBe(401);
    const { token, id, setCookie } = await pair(t);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    expect(setCookie).toMatch(/Path=\/api\/display/);
    await t.app.displays.revoke(id, operator);
    expect((await post(token)).status).toBe(401);
  });

  it('stores only a hash of the token and audit-logs creation', async () => {
    const t = await boot();
    const { token } = await pair(t);
    const rows = await pool.query('SELECT token_hash FROM display_tokens');
    expect(rows.rows[0].token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(rows.rows[0].token_hash).not.toContain(token);
    const log = await db.select().from(auditLog).where(eq(auditLog.action, 'display.create'));
    expect(log).toHaveLength(1);
  });

  it('revoking a token ends that TV stream within seconds and tells it why', async () => {
    const t = await boot({ resyncMs: 200 });
    const { cookie, id } = await pair(t);
    const s = openStream(t.port, cookie);
    await s.frameWhere(() => true);
    await t.app.displays.revoke(id, operator);
    const start = Date.now();
    while (!s.ended && Date.now() - start < 3000) await sleep(20);
    expect(s.ended).toBe(true);
    expect(s.events.some((e) => e.event === 'revoked')).toBe(true);
  });
});

describe('live stream', () => {
  it('sends the current standings on connect, then pushes a vote through NOTIFY (no polling)', async () => {
    const { a, x, y } = await seed();
    await castVotes(a.id, x.id, 2);
    const t = await boot(); // resync is 60 s: only NOTIFY can deliver the next frame in time
    const { cookie } = await pair(t);
    const s = openStream(t.port, cookie);

    const first = await s.frameWhere(() => true);
    expect(first.mode).toBe('LIVE');
    expect(first.categories[0]!.exhibitors.map((e) => [e.nameEn, e.votes])).toEqual([
      ['Xavier', 2],
    ]);

    const sent = Date.now();
    await castVotes(a.id, y.id, 3);
    const next = await s.frameWhere((f) => f.totalVotes === 5, 2000);
    expect(Date.now() - sent).toBeLessThan(1500);
    expect(next.categories[0]!.exhibitors.map((e) => [e.nameEn, e.votes, e.rank])).toEqual([
      ['Yara', 3, 1],
      ['Xavier', 2, 2],
    ]);
  });

  it('coalesces a burst of votes into far fewer frames', async () => {
    const { a, x } = await seed();
    const t = await boot({ minIntervalMs: 200 });
    const { cookie } = await pair(t);
    const s = openStream(t.port, cookie);
    await s.frameWhere(() => true);
    const before = s.frames().length;
    await Promise.all(Array.from({ length: 30 }, () => castVotes(a.id, x.id, 1)));
    await s.frameWhere((f) => f.totalVotes === 30, 3000);
    expect(s.frames().length - before).toBeLessThan(15);
  });

  it('sends heartbeats carrying the server clock', async () => {
    const t = await boot();
    const { cookie } = await pair(t);
    const s = openStream(t.port, cookie);
    const start = Date.now();
    while (!s.events.some((e) => e.event === 'time') && Date.now() - start < 2000) await sleep(20);
    const beat = s.events.find((e) => e.event === 'time')!;
    expect(Math.abs(Date.parse(JSON.parse(beat.data).serverTime) - Date.now())).toBeLessThan(2000);
  });

  it('streams the frame to every TV and carries no personal data', async () => {
    const { a, x } = await seed();
    await castVotes(a.id, x.id, 1);
    const t = await boot();
    const { cookie } = await pair(t);
    const s1 = openStream(t.port, cookie);
    const s2 = openStream(t.port, cookie);
    await s1.frameWhere(() => true);
    await s2.frameWhere(() => true);
    for (const s of [s1, s2]) {
      expect(s.raw).not.toMatch(/visitor|phone|client_ip|token/i);
    }
  });
});

describe('Blind Hour (ADR-003): sealed means sealed', () => {
  it('FROZEN: TVs switch at once, keep the snapshot while votes keep landing, and never see newer counts', async () => {
    const { a, x, y } = await seed();
    await castVotes(a.id, x.id, 4);
    const t = await boot();
    const { cookie } = await pair(t);
    const s = openStream(t.port, cookie);
    await s.frameWhere((f) => f.totalVotes === 4);

    const asked = Date.now();
    await t.app.results.setMode('FROZEN', operator);
    const frozen = await s.frameWhere((f) => f.mode === 'FROZEN', 1500);
    expect(Date.now() - asked).toBeLessThan(1000);
    expect(frozen.totalVotes).toBe(4);
    expect(frozen.frozenAt).not.toBeNull();

    // Voting is untouched: more votes are accepted and counted…
    await castVotes(a.id, y.id, 25);
    expect((await db.select().from(votes)).length).toBe(29);
    await sleep(700); // …several coalescing windows and a resync-sized wait later…
    // …no TV frame ever carried them.
    expect(
      s
        .frames()
        .filter((f) => f.mode === 'FROZEN')
        .every((f) => f.totalVotes === 4),
    ).toBe(true);
    const afterFreeze = s.raw.slice(s.raw.indexOf('"mode":"FROZEN"'));
    expect(afterFreeze).not.toMatch(/"votes":25|"totalVotes":29/);

    // A TV that connects (or refreshes) mid-freeze gets the snapshot, not the live numbers.
    const late = openStream(t.port, cookie);
    const lateFrame = await late.frameWhere(() => true);
    expect(lateFrame.mode).toBe('FROZEN');
    expect(lateFrame.totalVotes).toBe(4);
    expect(late.raw).not.toMatch(/"votes":25|"totalVotes":29/);
  });

  it('re-freezing while frozen keeps the ORIGINAL snapshot; going LIVE shows everything again', async () => {
    const { a, x, y } = await seed();
    await castVotes(a.id, x.id, 2);
    const t = await boot();
    await t.app.results.setMode('FROZEN', operator);
    await castVotes(a.id, y.id, 5);
    const again = await t.app.results.setMode('FROZEN', operator);
    expect(again.changed).toBe(false);
    expect((await t.app.results.frame()).totalVotes).toBe(2);

    await t.app.results.setMode('LIVE', operator);
    expect((await t.app.results.frame()).totalVotes).toBe(7);
    const [s] = await db.select().from(settings);
    expect(s!.frozenSnapshot).toBeNull();
    expect(s!.frozenAt).toBeNull();
  });

  it('freezing before a category has any vote shows it as empty (0), not sealed', async () => {
    await seed();
    const t = await boot();
    await t.app.results.setMode('FROZEN', operator);
    const frame = await t.app.results.frame();
    expect(frame.categories.map((c) => [c.sealed, c.total])).toEqual([
      [false, 0],
      [false, 0],
    ]);
    expect(frame.totalVotes).toBe(0);
  });

  it('FROZEN → HIDDEN → FROZEN restores the original sealed standings instead of taking a new snapshot', async () => {
    const { a, x, y } = await seed();
    await castVotes(a.id, x.id, 3);
    const t = await boot();
    await t.app.results.setMode('FROZEN', operator);
    await castVotes(a.id, y.id, 9);
    await t.app.results.setMode('HIDDEN', operator);
    expect((await t.app.results.frame()).totalVotes).toBeNull();
    const back = await t.app.results.setMode('FROZEN', operator);
    expect(back.changed).toBe(true);
    const frame = await t.app.results.frame();
    expect(frame.totalVotes).toBe(3); // the votes cast while hidden stay unseen
    expect(frame.categories[0]!.exhibitors.map((e) => e.votes)).toEqual([3]);
    // Going through LIVE is how an organiser takes a fresh snapshot.
    await t.app.results.setMode('LIVE', operator);
    await t.app.results.setMode('FROZEN', operator);
    expect((await t.app.results.frame()).totalVotes).toBe(12);
  });

  it('only a revocation announces a display change; connecting a TV does not', async () => {
    await seed();
    const t = await boot();
    const { cookie, id } = await pair(t);
    const heard: string[] = [];
    const listener = new pg.Client({ connectionString: testDatabaseUrl() });
    await listener.connect();
    listener.on('notification', (m) => heard.push(m.payload ?? ''));
    await listener.query('LISTEN mc_results');
    try {
      const s = openStream(t.port, cookie); // connecting runs the "last seen" touch
      await s.frameWhere(() => true);
      await sleep(300);
      expect(heard).not.toContain('display');
      await t.app.displays.revoke(id, operator);
      await sleep(300);
      expect(heard).toContain('display');
    } finally {
      await listener.end();
    }
  });

  it('HIDDEN sends no counts at all, even with votes pouring in', async () => {
    const { a, x } = await seed();
    await castVotes(a.id, x.id, 3);
    const t = await boot();
    const { cookie } = await pair(t);
    const s = openStream(t.port, cookie);
    await s.frameWhere((f) => f.totalVotes === 3);
    await t.app.results.setMode('HIDDEN', operator);
    const hidden = await s.frameWhere((f) => f.mode === 'HIDDEN');
    expect(hidden.totalVotes).toBeNull();
    await castVotes(a.id, x.id, 10);
    await sleep(400);
    const afterHidden = s.raw.slice(s.raw.indexOf('"mode":"HIDDEN"'));
    expect(afterHidden).not.toMatch(/"votes"|"total":\d|"totalVotes":\d|"voters":\d/);
  });

  it('REVEAL announces one category at a time with the standings of that moment', async () => {
    const { a, b, x, y, z } = await seed();
    await castVotes(a.id, x.id, 3);
    await castVotes(a.id, y.id, 6);
    await castVotes(b.id, z.id, 2);
    const t = await boot();
    const { cookie } = await pair(t);
    const s = openStream(t.port, cookie);
    await t.app.results.setMode('FROZEN', operator);
    await t.app.results.setMode('REVEAL', operator);
    const sealed = await s.frameWhere((f) => f.mode === 'REVEAL');
    expect(sealed.categories.every((c) => c.sealed)).toBe(true);
    expect(sealed.spotlight).toBeNull();

    await t.app.results.revealCategory({ slug: 'robots' }, operator);
    const one = await s.frameWhere((f) => f.mode === 'REVEAL' && f.spotlight !== null);
    expect(one.spotlight).toMatchObject({ categoryId: a.id, seq: 1 });
    expect(one.categories.map((c) => c.sealed)).toEqual([false, true]);
    expect(one.categories[0]!.exhibitors[0]).toMatchObject({ nameEn: 'Yara', votes: 6, rank: 1 });

    // A late vote cannot change an announced winner; the unannounced category stays sealed.
    await castVotes(a.id, x.id, 50);
    await castVotes(b.id, z.id, 50);
    await sleep(300);
    const latest = await t.app.results.frame();
    expect(latest.categories[0]!.exhibitors[0]).toMatchObject({ nameEn: 'Yara', votes: 6 });
    expect(latest.categories[1]).toMatchObject({ sealed: true, total: null });
    expect(JSON.stringify(latest)).not.toMatch(/"votes":52|"votes":53/);

    // Idempotent: announcing it again does not move the spotlight.
    expect((await t.app.results.revealCategory({ slug: 'robots' }, operator)).changed).toBe(false);
    await t.app.results.revealCategory({ categoryId: b.id }, operator);
    const two = await s.frameWhere((f) => f.spotlight?.seq === 2);
    expect(two.categories.map((c) => c.sealed)).toEqual([false, false]);
  });

  it('revealing outside REVEAL, or an unknown category, is refused; every change is audit-logged', async () => {
    await seed();
    const t = await boot();
    await expect(t.app.results.revealCategory({ slug: 'robots' }, operator)).rejects.toMatchObject({
      statusCode: 409,
    });
    await t.app.results.setMode('REVEAL', operator);
    await expect(t.app.results.revealCategory({ slug: 'nope' }, operator)).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(
      t.app.results.revealCategory({ categoryId: randomUUID() }, operator),
    ).rejects.toMatchObject({ statusCode: 404 });
    await t.app.results.revealCategory({ slug: 'apps' }, operator);
    const actions = (await db.select().from(auditLog)).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['results.mode', 'results.reveal']));
  });

  it('a TV connecting at the very instant the mode changes never ends up on the old mode', async () => {
    const { a, x } = await seed();
    await castVotes(a.id, x.id, 2);
    const t = await boot(); // 60 s resync: only the hub logic can rescue a lost notification
    const { cookie } = await pair(t);
    let expected: 'LIVE' | 'FROZEN' = 'LIVE';
    for (let i = 0; i < 10; i++) {
      expected = expected === 'LIVE' ? 'FROZEN' : 'LIVE';
      const s = openStream(t.port, cookie); // not awaited: it races the change below
      if (i % 2) await sleep(i); // vary the interleaving
      await t.app.results.setMode(expected, operator);
      const deadline = Date.now() + 1500;
      while (Date.now() < deadline && s.frames().at(-1)?.mode !== expected) await sleep(10);
      expect(s.frames().at(-1)?.mode, `iteration ${i}`).toBe(expected);
      s.close();
    }
  });

  it('the database refuses FROZEN without a snapshot (defence in depth)', async () => {
    await expect(
      pool.query(`UPDATE settings SET results_visibility = 'FROZEN'`),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('resilience', () => {
  it('keeps pushing after Postgres drops the LISTEN connection', async () => {
    const { a, x } = await seed();
    const t = await boot();
    const { cookie } = await pair(t);
    const s = openStream(t.port, cookie);
    await s.frameWhere(() => true);
    await pool.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'mc-results-listener'`,
    );
    await sleep(1800); // backoff 500 ms (+ jitter), then reconnect + resync
    await castVotes(a.id, x.id, 2);
    await s.frameWhere((f) => f.totalVotes === 2, 4000);
  });

  it('a TV that connects while the database is unreachable gets no stale frame (fails closed)', async () => {
    const { a, x } = await seed();
    await castVotes(a.id, x.id, 1);
    const t = await boot();
    const { cookie } = await pair(t);
    const warm = openStream(t.port, cookie);
    await warm.frameWhere(() => true);
    warm.close();
    // Simulate the frame computation failing, then a new TV arriving.
    const original = t.app.results.frame.bind(t.app.results);
    t.app.results.frame = async () => {
      throw new Error('db down');
    };
    await sleep(40);
    const s = openStream(t.port, cookie);
    await s.ready;
    await sleep(200);
    expect(s.frames()).toHaveLength(0);
    t.app.results.frame = original;
    // After the automatic reconnect the TV is served normally again.
    const again = openStream(t.port, cookie);
    await again.frameWhere(() => true);
  });

  it('shuts down promptly even with TVs connected, and a restarted replica serves them again', async () => {
    const { a, x } = await seed();
    await castVotes(a.id, x.id, 1);
    const t = await boot();
    const { cookie } = await pair(t);
    const s = openStream(t.port, cookie);
    await s.frameWhere(() => true);
    apps = apps.filter((a) => a !== t); // closed here; afterEach must not close it twice
    const started = Date.now();
    await t.app.close();
    expect(Date.now() - started).toBeLessThan(2500);
    await sleep(50);
    expect(s.ended).toBe(true);

    const t2 = await boot(); // "restart"
    const s2 = openStream(t2.port, cookie);
    const f = await s2.frameWhere(() => true);
    expect(f.totalVotes).toBe(1);
  });
});
