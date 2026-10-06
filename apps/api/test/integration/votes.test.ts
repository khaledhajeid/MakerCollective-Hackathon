import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import {
  categories,
  exhibitorCategories,
  exhibitors,
  settings,
  visitors,
  votes,
} from '../../src/db/schema.js';
import type { SmsProvider } from '../../src/modules/sms/provider.js';
import { testEnv } from '../helpers.js';
import { openTestDb } from './db.js';

const { pool, db, reset } = openTestDb();
afterAll(() => pool.end());

const VENUE_IP = '203.0.113.50';
const OUTSIDE_IP = '198.51.100.9';

let sent: string[];
const sms: SmsProvider = {
  name: 'console',
  async send(m) {
    sent.push(m.text);
  },
};

async function makeApp() {
  const app = await buildApp({
    env: testEnv({ TRUST_PROXY: '172.28.0.10' }),
    db,
    redis: null,
    sms,
  });
  const call = (
    method: 'GET' | 'POST',
    url: string,
    opts: { ip?: string; body?: unknown; cookies?: Record<string, string> } = {},
  ) =>
    app.inject({
      method,
      url,
      remoteAddress: '172.28.0.10',
      headers: { 'x-forwarded-for': opts.ip ?? VENUE_IP },
      cookies: opts.cookies,
      payload: opts.body as object | undefined,
    });
  /** Registers a visitor through the real OTP flow and returns their session cookies. */
  let n = 0;
  const login = async (phone = `079${String(1_000_000 + n++)}`) => {
    const r = await call('POST', '/api/auth/otp/request', {
      body: {
        name: 'Layla Haddad',
        phone,
        voteConsent: true,
        outreachConsent: false,
        locale: 'ar',
      },
    });
    const code = /(\d{6})/.exec(sent.at(-1)!)![1]!;
    const v = await call('POST', '/api/auth/otp/verify', {
      body: { challengeId: r.json().challengeId, code },
    });
    return Object.fromEntries(v.cookies.map((c) => [c.name, c.value]));
  };
  return { app, call, login };
}

async function seedCatalog() {
  const [a, b] = await db
    .insert(categories)
    .values([
      { slug: 'a', nameEn: 'A', nameAr: 'أ' },
      { slug: 'b', nameEn: 'B', nameAr: 'ب' },
    ])
    .returning();
  const [x, y, z] = await db
    .insert(exhibitors)
    .values([{ nameEn: 'X' }, { nameEn: 'Y' }, { nameEn: 'Z' }])
    .returning();
  await db.insert(exhibitorCategories).values([
    { exhibitorId: x!.id, categoryId: a!.id },
    { exhibitorId: y!.id, categoryId: a!.id },
    { exhibitorId: z!.id, categoryId: b!.id },
  ]);
  return { a: a!, b: b!, x: x!, y: y!, z: z! };
}

beforeEach(async () => {
  sent = [];
  await reset();
  await db.update(settings).set({
    accessMode: 'IP_ALLOWLIST',
    venueCidrs: ['203.0.113.0/24'],
    wifiSsid: 'MC2026',
    votingStatus: 'OPEN',
  });
});

describe('POST /api/votes — access control (F10/F11)', () => {
  it('refuses a vote from outside the venue, even with a valid session', async () => {
    const { call, login } = await makeApp();
    const { a, x } = await seedCatalog();
    const cookies = await login();
    const res = await call('POST', '/api/votes', {
      ip: OUTSIDE_IP,
      cookies,
      body: { categoryId: a.id, exhibitorId: x.id },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatchObject({
      code: 'NOT_ON_VENUE_NETWORK',
      details: { wifiSsid: 'MC2026' },
    });
    expect(await db.$count(votes)).toBe(0);
  });

  it('requires a session', async () => {
    const { call } = await makeApp();
    const { a, x } = await seedCatalog();
    const res = await call('POST', '/api/votes', { body: { categoryId: a.id, exhibitorId: x.id } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a forged / tampered session cookie', async () => {
    const { call, login } = await makeApp();
    const { a, x } = await seedCatalog();
    const cookies = await login();
    const res = await call('POST', '/api/votes', {
      cookies: { ...cookies, mc_session: `${cookies.mc_session!.slice(0, -2)}xx` },
      body: { categoryId: a.id, exhibitorId: x.id },
    });
    expect(res.statusCode).toBe(401);
  });

  it('stops working the moment the visitor logs out (revoked session) or is blocked', async () => {
    const { call, login } = await makeApp();
    const { a, x, b, z } = await seedCatalog();
    const cookies = await login();
    expect(
      (await call('POST', '/api/votes', { cookies, body: { categoryId: a.id, exhibitorId: x.id } }))
        .statusCode,
    ).toBe(200);
    await new Promise((r) => setTimeout(r, 5));
    await call('POST', '/api/auth/logout', { cookies });
    const afterLogout = await call('POST', '/api/votes', {
      cookies,
      body: { categoryId: b.id, exhibitorId: z.id },
    });
    expect(afterLogout.statusCode).toBe(401);

    const fresh = await login('0797654321');
    await db.update(visitors).set({ isBlocked: true }).where(eq(visitors.isBlocked, false));
    const blocked = await call('POST', '/api/votes', {
      cookies: fresh,
      body: { categoryId: b.id, exhibitorId: z.id },
    });
    expect(blocked.statusCode).toBe(401);
  });
});

describe('POST /api/votes — voting window (F9)', () => {
  it.each([
    ['CLOSED', { votingStatus: 'CLOSED' as const }, 'CLOSED'],
    [
      'SCHEDULED with a future opening',
      {
        votingStatus: 'SCHEDULED' as const,
        votingOpensAt: new Date(Date.now() + 3_600_000),
      },
      'NOT_YET_OPEN',
    ],
    [
      'SCHEDULED with a past closing',
      {
        votingStatus: 'SCHEDULED' as const,
        votingOpensAt: new Date(Date.now() - 7_200_000),
        votingClosesAt: new Date(Date.now() - 3_600_000),
      },
      'CLOSED',
    ],
    ['SCHEDULED, unconfigured', { votingStatus: 'SCHEDULED' as const }, 'NOT_YET_OPEN'],
  ])('refuses votes while %s', async (_name, patch, state) => {
    const { call, login, app } = await makeApp();
    const { a, x } = await seedCatalog();
    const cookies = await login();
    await db.update(settings).set(patch);
    app.settings.invalidate();
    const res = await call('POST', '/api/votes', {
      cookies,
      body: { categoryId: a.id, exhibitorId: x.id },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatchObject({ code: 'VOTING_NOT_OPEN', details: { state } });
    expect(await db.$count(votes)).toBe(0);
  });

  it('GET /api/voting/status is public and reflects the server clock, uncached', async () => {
    const { call } = await makeApp();
    const open = await call('GET', '/api/voting/status', { ip: OUTSIDE_IP });
    expect(open.json()).toEqual({ state: 'OPEN', opensAt: null, closesAt: null });
    expect(open.headers['cache-control']).toBe('no-store');
  });
});

describe('POST /api/votes — casting (F2, F3, F12)', () => {
  it('records a vote with the canonical client IP and lists it under /me/votes', async () => {
    const { call, login } = await makeApp();
    const { a, x } = await seedCatalog();
    const cookies = await login();
    const res = await call('POST', '/api/votes', {
      cookies,
      body: { categoryId: a.id, exhibitorId: x.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      alreadyRecorded: false,
      vote: { categoryId: a.id, exhibitorId: x.id },
    });
    const [row] = await db.select().from(votes);
    expect(row!.clientIp).toBe(VENUE_IP);

    const mine = await call('GET', '/api/me/votes', { cookies });
    expect(mine.json().votes).toHaveLength(1);
    expect(mine.headers['cache-control']).toContain('no-store');
  });

  it('lets one visitor vote once in each category', async () => {
    const { call, login } = await makeApp();
    const { a, b, x, z } = await seedCatalog();
    const cookies = await login();
    for (const [categoryId, exhibitorId] of [
      [a.id, x.id],
      [b.id, z.id],
    ] as const) {
      const res = await call('POST', '/api/votes', { cookies, body: { categoryId, exhibitorId } });
      expect(res.statusCode).toBe(200);
    }
    expect((await call('GET', '/api/me/votes', { cookies })).json().votes).toHaveLength(2);
  });

  it('is idempotent: the same vote again succeeds as alreadyRecorded (offline retry) and adds nothing', async () => {
    const { call, login } = await makeApp();
    const { a, x } = await seedCatalog();
    const cookies = await login();
    const body = { categoryId: a.id, exhibitorId: x.id };
    const first = await call('POST', '/api/votes', { cookies, body });
    const again = await call('POST', '/api/votes', { cookies, body });
    expect(again.statusCode).toBe(200);
    expect(again.json().alreadyRecorded).toBe(true);
    expect(again.json().vote.createdAt).toBe(first.json().vote.createdAt);
    expect(await db.$count(votes)).toBe(1);
  });

  it('votes are final: a different choice is refused with 409 and the original stands', async () => {
    const { call, login } = await makeApp();
    const { a, x, y } = await seedCatalog();
    const cookies = await login();
    await call('POST', '/api/votes', { cookies, body: { categoryId: a.id, exhibitorId: x.id } });
    const res = await call('POST', '/api/votes', {
      cookies,
      body: { categoryId: a.id, exhibitorId: y.id },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({
      code: 'ALREADY_VOTED',
      details: { categoryId: a.id, exhibitorId: x.id },
    });
    const [row] = await db.select().from(votes);
    expect(row!.exhibitorId).toBe(x.id);
  });

  it('a parallel burst of different choices yields exactly one vote', async () => {
    const { call, login } = await makeApp();
    const { a, x, y } = await seedCatalog();
    const cookies = await login();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        call('POST', '/api/votes', {
          cookies,
          body: { categoryId: a.id, exhibitorId: i % 2 ? x.id : y.id },
        }),
      ),
    );
    expect(results.filter((r) => r.statusCode === 200 && !r.json().alreadyRecorded)).toHaveLength(
      1,
    );
    expect(results.every((r) => [200, 409].includes(r.statusCode))).toBe(true);
    expect(await db.$count(votes)).toBe(1);
  });

  it('two visitors vote independently', async () => {
    const { call, login } = await makeApp();
    const { a, x } = await seedCatalog();
    for (const cookies of [await login(), await login()]) {
      const res = await call('POST', '/api/votes', {
        cookies,
        body: { categoryId: a.id, exhibitorId: x.id },
      });
      expect(res.statusCode).toBe(200);
    }
    expect(await db.$count(votes)).toBe(2);
  });

  it('refuses an exhibitor that is not in the category, or is archived, or in an inactive category', async () => {
    const { call, login, app } = await makeApp();
    const { a, b, x, z } = await seedCatalog();
    const cookies = await login();
    const wrong = await call('POST', '/api/votes', {
      cookies,
      body: { categoryId: a.id, exhibitorId: z.id },
    });
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json().error.code).toBe('EXHIBITOR_NOT_IN_CATEGORY');

    await db.update(exhibitors).set({ isActive: false }).where(eq(exhibitors.id, x.id));
    expect(
      (await call('POST', '/api/votes', { cookies, body: { categoryId: a.id, exhibitorId: x.id } }))
        .statusCode,
    ).toBe(422);

    await db.update(categories).set({ isActive: false }).where(eq(categories.id, b.id));
    expect(
      (await call('POST', '/api/votes', { cookies, body: { categoryId: b.id, exhibitorId: z.id } }))
        .statusCode,
    ).toBe(422);
    expect(app).toBeDefined();
    expect(await db.$count(votes)).toBe(0);
  });

  it('validates the body', async () => {
    const { call, login } = await makeApp();
    const cookies = await login();
    for (const body of [
      {},
      { categoryId: 'nope', exhibitorId: 'nope' },
      { categoryId: crypto.randomUUID() },
    ]) {
      const res = await call('POST', '/api/votes', { cookies, body });
      expect(res.statusCode).toBe(400);
    }
  });

  it('works with the venue gate switched OFF (dev) and still needs a session', async () => {
    const { call, login, app } = await makeApp();
    const { a, x } = await seedCatalog();
    const cookies = await login();
    await db.update(settings).set({ accessMode: 'OFF' });
    app.settings.invalidate();
    const ok = await call('POST', '/api/votes', {
      ip: OUTSIDE_IP,
      cookies,
      body: { categoryId: a.id, exhibitorId: x.id },
    });
    expect(ok.statusCode).toBe(200);
  });
});

describe('GET /api/me/votes', () => {
  it("requires a session and shows only the caller's votes", async () => {
    const { call, login } = await makeApp();
    const { a, x } = await seedCatalog();
    expect((await call('GET', '/api/me/votes')).statusCode).toBe(401);
    const [one, two] = [await login(), await login()];
    await call('POST', '/api/votes', {
      cookies: one,
      body: { categoryId: a.id, exhibitorId: x.id },
    });
    expect((await call('GET', '/api/me/votes', { cookies: two })).json().votes).toEqual([]);
  });
});
