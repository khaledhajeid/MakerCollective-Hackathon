import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { AdminRole } from '@mc/shared';
import { buildApp } from '../../src/app.js';
import {
  adminUsers,
  auditLog,
  categories,
  exhibitorPhotos,
  exhibitors,
  otpChallenges,
  smsOutbox,
  visitors,
  votes,
} from '../../src/db/schema.js';
import { csvCell, toCsv } from '../../src/modules/export/csv.js';
import { slugify } from '../../src/modules/content/service.js';
import type { SmsProvider } from '../../src/modules/sms/provider.js';
import { testEnv } from '../helpers.js';
import { openTestDb } from './db.js';

const { pool, db, reset } = openTestDb();
afterAll(() => pool.end());

const COOKIE = 'mc_admin';
const env = testEnv();

let sent: string[];
const sms: SmsProvider = {
  name: 'console',
  async send(m) {
    sent.push(m.text);
  },
};

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
type App = Awaited<ReturnType<typeof makeApp>>;
async function makeApp() {
  const app = await buildApp({ env, db, redis: null, sms });
  const as = (who: { cookie: string; csrf: string }) => {
    const call = (
      method: Method,
      url: string,
      o: {
        body?: unknown;
        raw?: Buffer;
        type?: string;
        ip?: string;
        headers?: Record<string, string>;
      } = {},
    ) =>
      app.inject({
        method,
        url,
        remoteAddress: o.ip ?? '127.0.0.1',
        headers: {
          'x-csrf-token': who.csrf,
          ...(o.type ? { 'content-type': o.type } : {}),
          ...o.headers,
        },
        cookies: { [COOKIE]: who.cookie },
        payload: (o.raw ?? o.body) as object | undefined,
      });
    return call;
  };
  const anon = (method: Method, url: string, o: { ip?: string; body?: unknown } = {}) =>
    app.inject({
      method,
      url,
      remoteAddress: o.ip ?? '127.0.0.1',
      payload: o.body as object | undefined,
    });
  return { app, as, anon };
}

let ctx: App;
let seq = 0;
async function admin(role: AdminRole = 'SUPER_ADMIN') {
  const [row] = await db
    .insert(adminUsers)
    .values({
      username: `tester${++seq}`,
      passwordHash: 'x',
      role,
      mfaEnabled: true,
      totpSecretEnc: 'x',
    })
    .returning({ id: adminUsers.id, username: adminUsers.username });
  // A fully signed-in session issued directly: these tests are about what the console may do, not about signing in.
  const s = await ctx.app.adminSessions.create(row!.id, true, { ip: null, userAgent: null });
  return { id: row!.id, username: row!.username, cookie: s.token, csrf: s.csrfToken };
}
const audit = (action: string) => db.select().from(auditLog).where(eq(auditLog.action, action));

beforeEach(async () => {
  await reset();
  sent = [];
  ctx = await makeApp();
});

/* ───────────── fixtures ───────────── */

/** A structurally valid WebP (lossless) of the given size. The parser reads structure, so the pixels need not decode. */
function webp(
  width = 800,
  height = 600,
  o: { extraChunk?: [string, number]; flags?: number; trailing?: number; riffDelta?: number } = {},
): Buffer {
  const chunk = (id: string, payload: Buffer) => {
    const head = Buffer.alloc(8);
    head.write(id, 0, 'latin1');
    head.writeUInt32LE(payload.length, 4);
    return Buffer.concat([head, payload, payload.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };
  const vp8l = Buffer.alloc(24);
  vp8l[0] = 0x2f;
  vp8l.writeUInt32LE((width - 1) | ((height - 1) << 14), 1);
  const parts: Buffer[] = [];
  if (o.flags !== undefined) {
    const x = Buffer.alloc(10);
    x[0] = o.flags;
    x.writeUIntLE(width - 1, 4, 3);
    x.writeUIntLE(height - 1, 7, 3);
    parts.push(chunk('VP8X', x));
  }
  parts.push(chunk('VP8L', vp8l));
  if (o.extraChunk) parts.push(chunk(o.extraChunk[0], Buffer.alloc(o.extraChunk[1], 1)));
  const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), ...parts]);
  const head = Buffer.alloc(8);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length + (o.riffDelta ?? 0), 4);
  return Buffer.concat([head, body, Buffer.alloc(o.trailing ?? 0)]);
}

async function category(over: Record<string, unknown> = {}) {
  const [row] = await db
    .insert(categories)
    .values({ slug: `cat-${++seq}`, nameEn: `Category ${seq}`, nameAr: `فئة ${seq}`, ...over })
    .returning();
  return row!;
}
async function exhibitor(categoryIds: string[] = [], over: Record<string, unknown> = {}) {
  const [row] = await db
    .insert(exhibitors)
    .values({ nameEn: `Exhibitor ${++seq}`, ...over })
    .returning();
  for (const categoryId of categoryIds)
    await pool.query(
      'INSERT INTO exhibitor_categories (exhibitor_id, category_id) VALUES ($1, $2)',
      [row!.id, categoryId],
    );
  return row!;
}
async function visitor(
  o: { consent?: boolean; blocked?: boolean; name?: string; phone?: string } = {},
) {
  const { FieldCipher, hmacHex } = await import('../../src/lib/crypto.js');
  const cipher = new FieldCipher(env.PII_ENCRYPTION_KEY);
  const phone = o.phone ?? `+96279${String(1_000_000 + ++seq)}`;
  const [row] = await db
    .insert(visitors)
    .values({
      nameEnc: cipher.encrypt(o.name ?? 'Layla Haddad', 'visitor.name'),
      phoneEnc: cipher.encrypt(phone, 'visitor.phone'),
      phoneHash: hmacHex(env.PHONE_HASH_PEPPER, phone),
      voteConsentAt: new Date(),
      outreachConsentAt: o.consent ? new Date() : null,
      consentVersion: 'v1',
      isBlocked: o.blocked ?? false,
      deviceId: randomUUID(),
    })
    .returning();
  return { ...row!, phone };
}
const castVote = (visitorId: string, categoryId: string, exhibitorId: string) =>
  db.insert(votes).values({ visitorId, categoryId, exhibitorId });

/* ═══════════════════ categories & exhibitors ═══════════════════ */

describe('categories', () => {
  it('creates one with a readable unique slug, appends it to the order, and audits it', async () => {
    const a = await admin();
    const call = ctx.as(a);
    const body = { nameEn: 'Best Robot', nameAr: 'أفضل روبوت', color: '#7F32D9' };
    const first = await call('POST', '/api/admin/categories', { body });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      slug: 'best-robot',
      color: '#7f32d9',
      sortOrder: 0,
      isActive: true,
    });
    const second = await call('POST', '/api/admin/categories', { body });
    expect(second.json()).toMatchObject({ slug: 'best-robot-2', sortOrder: 1 });
    const [entry] = await audit('category.create');
    expect(entry!.actorAdminId).toBe(a.id);
    expect(slugify('  Ünïcode & Fun!! ')).toBe('unicode-fun');
    expect(slugify('روبوت')).toBe('category');
  });

  it('refuses control characters, bad colours and unknown fields', async () => {
    const call = ctx.as(await admin());
    const ok = { nameEn: 'X', nameAr: 'س', color: '#112233' };
    for (const bad of [
      { ...ok, nameEn: 'line\nbreak' },
      { ...ok, nameEn: '' },
      { ...ok, color: 'purple' },
      { ...ok, color: '#12345' },
      { ...ok, nameEn: 'x'.repeat(81) },
    ])
      expect((await call('POST', '/api/admin/categories', { body: bad })).statusCode).toBe(400);
    expect(await db.$count(categories)).toBe(0);
    const c = await category();
    expect(
      (await call('PATCH', `/api/admin/categories/${c.id}`, { body: { slug: 'hacked' } }))
        .statusCode,
    ).toBe(400);
  });

  it('updates fields, records only what changed, and shows the change to voters at once', async () => {
    const call = ctx.as(await admin());
    const c = await category({ nameEn: 'Old', color: '#112233' });
    const res = await call('PATCH', `/api/admin/categories/${c.id}`, {
      body: { nameEn: 'New', color: '#112233', isActive: true },
    });
    expect(res.statusCode).toBe(200);
    const [entry] = await audit('category.update');
    expect(entry!.details).toMatchObject({ changes: { nameEn: { from: 'Old', to: 'New' } } });
    expect(Object.keys((entry!.details as { changes: object }).changes)).toEqual(['nameEn']);
    const catalog = await ctx.anon('GET', '/api/catalog');
    expect(catalog.json().categories[0].nameEn).toBe('New');
    // A hidden category leaves the voters' catalog.
    await call('PATCH', `/api/admin/categories/${c.id}`, { body: { isActive: false } });
    expect((await ctx.anon('GET', '/api/catalog')).json().categories).toHaveLength(0);
    expect(
      (await call('PATCH', `/api/admin/categories/${randomUUID()}`, { body: { nameEn: 'x' } }))
        .statusCode,
    ).toBe(404);
  });

  it('reorders only with the complete, current list', async () => {
    const call = ctx.as(await admin());
    const [a, b, c] = [await category(), await category(), await category()];
    const res = await call('PUT', '/api/admin/categories/order', {
      body: { ids: [c.id, a.id, b.id] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().categories.map((x: { id: string }) => x.id)).toEqual([c.id, a.id, b.id]);
    for (const ids of [
      [a.id, b.id],
      [a.id, b.id, c.id, randomUUID()],
      [a.id, a.id, b.id],
    ])
      expect((await call('PUT', '/api/admin/categories/order', { body: { ids } })).statusCode).toBe(
        409,
      );
  });

  it('deletes an empty category but never one that has votes', async () => {
    const call = ctx.as(await admin());
    const withVotes = await category();
    const e = await exhibitor([withVotes.id]);
    const v = await visitor();
    await castVote(v.id, withVotes.id, e.id);
    const res = await call('DELETE', `/api/admin/categories/${withVotes.id}`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toMatch(/Hide it instead/);
    expect(await db.$count(categories)).toBe(1);

    const empty = await category();
    expect((await call('DELETE', `/api/admin/categories/${empty.id}`)).statusCode).toBe(200);
    expect(await db.$count(categories)).toBe(1);
    expect((await audit('category.delete')).length).toBe(1);
  });
});

describe('exhibitors', () => {
  it('creates with categories, trims text, turns empty boxes into nothing', async () => {
    const call = ctx.as(await admin());
    const c = await category();
    const res = await call('POST', '/api/admin/exhibitors', {
      body: {
        nameEn: '  Atlas Robotics ',
        nameAr: '',
        booth: ' B12 ',
        descriptionEn: 'Line one\nLine two',
        categoryIds: [c.id, c.id],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      nameEn: 'Atlas Robotics',
      nameAr: null,
      booth: 'B12',
      categoryIds: [c.id],
      isActive: true,
      photoUrl: null,
      hasVotes: false,
    });
    const catalog = (await ctx.anon('GET', '/api/catalog')).json();
    expect(catalog.categories[0].exhibitors[0].nameEn).toBe('Atlas Robotics');
  });

  it('refuses unknown categories and over-long or control-character text', async () => {
    const call = ctx.as(await admin());
    const res = await call('POST', '/api/admin/exhibitors', {
      body: { nameEn: 'X', categoryIds: [randomUUID()] },
    });
    expect(res.statusCode).toBe(400);
    for (const bad of [
      { nameEn: 'a\u0000b', categoryIds: [] },
      { nameEn: 'x', descriptionEn: 'y'.repeat(601), categoryIds: [] },
      { nameEn: 'x', booth: 'z'.repeat(25), categoryIds: [] },
    ])
      expect((await call('POST', '/api/admin/exhibitors', { body: bad })).statusCode).toBe(400);
    expect(await db.$count(exhibitors)).toBe(0);
  });

  it('changes categories, but cannot remove one the exhibitor already has votes in', async () => {
    const call = ctx.as(await admin());
    const [a, b, c] = [await category(), await category(), await category()];
    const e = await exhibitor([a.id, b.id]);
    const res = await call('PATCH', `/api/admin/exhibitors/${e.id}`, {
      body: { categoryIds: [b.id, c.id] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().categoryIds.sort()).toEqual([b.id, c.id].sort());
    const [entry] = await audit('exhibitor.update');
    expect(entry!.details).toMatchObject({ categories: { added: 1, removed: 1 } });

    const v = await visitor();
    await castVote(v.id, b.id, e.id);
    const refused = await call('PATCH', `/api/admin/exhibitors/${e.id}`, {
      body: { categoryIds: [c.id] },
    });
    expect(refused.statusCode).toBe(409);
    // Nothing was half-applied.
    const rows = await pool.query(
      'SELECT category_id FROM exhibitor_categories WHERE exhibitor_id = $1',
      [e.id],
    );
    expect(rows.rows.map((r) => r.category_id).sort()).toEqual([b.id, c.id].sort());
  });

  it('deletes an exhibitor without votes (and its photo) but only hides one with votes', async () => {
    const call = ctx.as(await admin());
    const c = await category();
    const voted = await exhibitor([c.id]);
    const v = await visitor();
    await castVote(v.id, c.id, voted.id);
    expect((await call('DELETE', `/api/admin/exhibitors/${voted.id}`)).statusCode).toBe(409);

    const plain = await exhibitor([c.id]);
    await call('PUT', `/api/admin/exhibitors/${plain.id}/photo`, {
      raw: webp(),
      type: 'image/webp',
    });
    expect(await db.$count(exhibitorPhotos)).toBe(1);
    expect((await call('DELETE', `/api/admin/exhibitors/${plain.id}`)).statusCode).toBe(200);
    expect(await db.$count(exhibitorPhotos)).toBe(0);
    expect(await db.$count(exhibitors)).toBe(1);
  });
});

describe('exhibitor photos', () => {
  it('stores a valid WebP, serves it publicly with a year of caching, and replaces the old one', async () => {
    const call = ctx.as(await admin());
    const e = await exhibitor();
    const first = webp(800, 600);
    const res = await call('PUT', `/api/admin/exhibitors/${e.id}/photo`, {
      raw: first,
      type: 'image/webp',
    });
    expect(res.statusCode).toBe(200);
    const url = res.json().photoUrl as string;
    expect(url).toMatch(/^\/api\/photos\/[a-f0-9-]{36}\.webp$/);

    const served = await ctx.anon('GET', url);
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/webp');
    expect(served.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(served.rawPayload, first)).toBe(0);

    const second = await call('PUT', `/api/admin/exhibitors/${e.id}/photo`, {
      raw: webp(1000, 700),
      type: 'image/webp',
    });
    expect(second.json().photoUrl).not.toBe(url);
    expect((await ctx.anon('GET', url)).statusCode).toBe(404);
    expect(await db.$count(exhibitorPhotos)).toBe(1);

    const gone = await call('DELETE', `/api/admin/exhibitors/${e.id}/photo`);
    expect(gone.json().photoUrl).toBeNull();
    expect(await db.$count(exhibitorPhotos)).toBe(0);
    expect((await audit('exhibitor.photo.set')).length).toBe(2);
    expect((await audit('exhibitor.photo.remove')).length).toBe(1);
  });

  it('refuses everything that is not a plain still WebP', async () => {
    const call = ctx.as(await admin());
    const e = await exhibitor();
    const put = (raw: Buffer, type = 'image/webp') =>
      call('PUT', `/api/admin/exhibitors/${e.id}/photo`, { raw, type });
    const cases: Array<[string, Buffer]> = [
      ['not a WebP', Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(100)])],
      [
        'a PNG',
        Buffer.concat([
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          Buffer.alloc(100),
        ]),
      ],
      ['an HTML file', Buffer.from('<script>alert(1)</script>'.padEnd(80, ' '))],
      ['an EXIF chunk', webp(800, 600, { extraChunk: ['EXIF', 40] })],
      ['an XMP chunk', webp(800, 600, { extraChunk: ['XMP ', 40] })],
      ['an ICC chunk', webp(800, 600, { extraChunk: ['ICCP', 40] })],
      ['an unknown chunk', webp(800, 600, { extraChunk: ['EVIL', 8] })],
      ['animation flag', webp(800, 600, { flags: 0x02 })],
      ['EXIF flag', webp(800, 600, { flags: 0x08 })],
      ['bytes hidden after the image', webp(800, 600, { trailing: 16 })],
      ['a lying RIFF size', webp(800, 600, { riffDelta: 4 })],
      ['too small a picture', webp(100, 100)],
      ['an absurd picture', webp(9000, 9000)],
    ];
    for (const [label, bytes] of cases) {
      const r = await put(bytes);
      expect(r.statusCode, label).toBe(400);
    }
    expect((await put(webp(), 'image/png')).statusCode).toBe(415);
    expect((await put(webp(), 'application/json')).statusCode).toBe(400);
    // Over the size limit: stopped at the door.
    const big = await put(Buffer.concat([webp(), Buffer.alloc(400 * 1024)]));
    expect(big.statusCode).toBe(413);
    expect(await db.$count(exhibitorPhotos)).toBe(0);
    // A plain alpha-flag WebP (VP8X + VP8L) is fine.
    expect((await put(webp(640, 480, { flags: 0x10 }))).statusCode).toBe(200);
  });

  it('only serves keys the server made', async () => {
    expect((await ctx.anon('GET', '/api/photos/..%2F..%2Fetc%2Fpasswd')).statusCode).toBe(400);
    expect((await ctx.anon('GET', '/api/photos/not-a-key.webp')).statusCode).toBe(400);
    expect((await ctx.anon('GET', `/api/photos/${randomUUID()}.webp`)).statusCode).toBe(404);
  });

  it('the database refuses a malformed key or an oversized blob even if code is bypassed', async () => {
    await expect(
      pool.query(
        `INSERT INTO exhibitor_photos (key, data, width, height) VALUES ('../x.webp', 'x', 1, 1)`,
      ),
    ).rejects.toThrow();
    await expect(
      pool.query(`INSERT INTO exhibitor_photos (key, data, width, height) VALUES ($1, $2, 1, 1)`, [
        `${randomUUID()}.webp`,
        Buffer.alloc(400_000),
      ]),
    ).rejects.toThrow();
  });
});

/* ═══════════════════ settings ═══════════════════ */

describe('settings', () => {
  it('reads and changes settings, audits the difference, never logs the Wi-Fi password', async () => {
    const call = ctx.as(await admin('ADMIN'));
    const before = (await call('GET', '/api/admin/settings')).json();
    const res = await call('PATCH', '/api/admin/settings', {
      body: {
        version: before.version,
        eventName: 'Maker Collective Finals',
        venueCidrs: ['203.0.113.0/24', '2001:db8:abcd:12::/64'],
        wifiSsid: 'MC2026',
        wifiPassword: 'super-secret-wifi',
        otpResendCooldownSeconds: 45,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      eventName: 'Maker Collective Finals',
      venueCidrs: ['203.0.113.0/24', '2001:db8:abcd:12::/64'],
      wifiPassword: 'super-secret-wifi',
      version: before.version + 1,
    });
    const [entry] = await audit('settings.update');
    expect(JSON.stringify(entry)).not.toContain('super-secret-wifi');
    expect(entry!.details).toMatchObject({ wifiPasswordChanged: true });
    expect(Object.keys((entry!.details as { changes: object }).changes).sort()).toEqual([
      'eventName',
      'otpResendCooldownSeconds',
      'venueCidrs',
      'wifiSsid',
    ]);
  });

  it('answers 409 when someone else changed the settings first', async () => {
    const call = ctx.as(await admin());
    const v = (await call('GET', '/api/admin/settings')).json().version;
    expect(
      (await call('PATCH', '/api/admin/settings', { body: { version: v, eventName: 'A' } }))
        .statusCode,
    ).toBe(200);
    const stale = await call('PATCH', '/api/admin/settings', {
      body: { version: v, eventName: 'B' },
    });
    expect(stale.statusCode).toBe(409);
    expect((await call('GET', '/api/admin/settings')).json().eventName).toBe('A');
    // Without a version (the one-click voting toggle) the change simply applies.
    expect(
      (await call('PATCH', '/api/admin/settings', { body: { eventName: 'C' } })).statusCode,
    ).toBe(200);
  });

  it('refuses malformed ranges, impossible windows and out-of-range policy values', async () => {
    const call = ctx.as(await admin());
    const patch = (body: object) => call('PATCH', '/api/admin/settings', { body });
    for (const bad of [
      { venueCidrs: ['203.0.113.5/33'] },
      { venueCidrs: ['not an ip'] },
      { venueCidrs: ['203.0.113.5/24'] }, // host bits set: Postgres refuses it
      { venueCidrs: ['999.1.1.1'] },
      { votingOpensAt: '2026-10-08T12:00:00Z', votingClosesAt: '2026-10-08T10:00:00Z' },
      { otpTtlSeconds: 5 },
      { otpMaxAttempts: 99 },
      { allowedPhonePrefixes: [] },
      { allowedPhonePrefixes: ['07'] },
      { accessMode: 'EVERYONE' },
      {},
      { unknownField: 1 },
    ])
      expect((await patch(bad)).statusCode, JSON.stringify(bad)).toBe(400);
    expect((await call('GET', '/api/admin/settings')).json().venueCidrs).toEqual([]);
  });

  it("takes effect on the voters' endpoints at once: window, gate and Wi-Fi hint", async () => {
    const call = ctx.as(await admin());
    expect((await ctx.anon('GET', '/api/voting/status')).json().state).toBe('NOT_YET_OPEN');
    await call('PATCH', '/api/admin/settings', { body: { votingStatus: 'OPEN' } });
    expect((await ctx.anon('GET', '/api/voting/status')).json().state).toBe('OPEN');
    await call('PATCH', '/api/admin/settings', { body: { votingStatus: 'CLOSED' } });
    expect((await ctx.anon('GET', '/api/voting/status')).json().state).toBe('CLOSED');

    // The gate: an empty allow-list refuses everyone; adding the caller's range admits them.
    const blocked = await ctx.anon('GET', '/api/access/status', { ip: '203.0.113.77' });
    expect(blocked.json().allowed).toBe(false);
    await call('PATCH', '/api/admin/settings', {
      body: { venueCidrs: ['203.0.113.0/24'], wifiSsid: 'MC2026' },
    });
    const admitted = await ctx.anon('GET', '/api/access/status', { ip: '203.0.113.77' });
    expect(admitted.json().allowed).toBe(true);
    const outside = (await ctx.anon('GET', '/api/access/status', { ip: '198.51.100.1' })).json();
    expect(outside).toMatchObject({ allowed: false, wifiSsid: 'MC2026' });
  });

  it('"add my current IP" suggests one IPv4 address or the /64 of an IPv6 address', async () => {
    const call = ctx.as(await admin());
    const v4 = (await call('GET', '/api/admin/network/me', { ip: '203.0.113.9' })).json();
    expect(v4).toMatchObject({
      ip: '203.0.113.9',
      family: 4,
      suggestion: '203.0.113.9',
      admitted: false,
    });
    const v6 = (
      await call('GET', '/api/admin/network/me', { ip: '2001:db8:abcd:12:aaaa:bbbb:cccc:dddd' })
    ).json();
    expect(v6).toMatchObject({ family: 6, suggestion: '2001:db8:abcd:12::/64' });
    await call('PATCH', '/api/admin/settings', {
      body: { venueCidrs: [v4.suggestion, v6.suggestion] },
    });
    expect(
      (await call('GET', '/api/admin/network/me', { ip: '203.0.113.9' })).json().admitted,
    ).toBe(true);
    expect(
      (await call('GET', '/api/admin/network/me', { ip: '2001:db8:abcd:12:1:2:3:4' })).json()
        .admitted,
    ).toBe(true);
  });
});

/* ═══════════════════ Blind Hour control, overview ═══════════════════ */

describe('results control and overview', () => {
  async function seeded() {
    const [c1, c2] = [await category({ sortOrder: 0 }), await category({ sortOrder: 1 })];
    const [e1, e2] = [await exhibitor([c1.id, c2.id]), await exhibitor([c1.id])];
    const people = [await visitor(), await visitor(), await visitor()];
    await castVote(people[0]!.id, c1.id, e1.id);
    await castVote(people[1]!.id, c1.id, e1.id);
    await castVote(people[2]!.id, c1.id, e2.id);
    await castVote(people[0]!.id, c2.id, e1.id);
    return { c1, c2, e1, e2, people };
  }

  it('the overview totals match the database and carry no per-exhibitor numbers', async () => {
    const call = ctx.as(await admin('ADMIN'));
    const { c1, c2 } = await seeded();
    await db.insert(otpChallenges).values({
      phoneHash: 'a'.repeat(64),
      codeHash: 'x',
      nameEnc: 'x',
      phoneEnc: 'x',
      consentVersion: 'v1',
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: new Date(),
    });
    await call('POST', '/api/admin/results/mode', { body: { mode: 'FROZEN' } });
    const res = await call('GET', '/api/admin/overview');
    expect(res.statusCode).toBe(200);
    const o = res.json();
    expect(o.totals).toEqual({ visitors: 3, votes: 4, voters: 3 });
    expect(o.categories.find((c: { id: string }) => c.id === c1.id).votes).toBe(3);
    expect(o.categories.find((c: { id: string }) => c.id === c2.id).votes).toBe(1);
    expect(o.perMinute).toHaveLength(30);
    expect(o.perMinute.reduce((n: number, m: { votes: number }) => n + m.votes, 0)).toBe(4);
    expect(o.otp).toEqual({ requested: 1, verified: 1 });
    expect(o.results.mode).toBe('FROZEN');
    // The Blind Hour: no exhibitor appears anywhere in the overview.
    expect(JSON.stringify(o)).not.toMatch(/exhibitor/i);
  });

  it('flags devices that registered several different phones', async () => {
    const call = ctx.as(await admin());
    const device = 'abcdef-shared-device';
    for (let i = 0; i < 3; i++) {
      const v = await visitor();
      await db.update(visitors).set({ deviceId: device }).where(eq(visitors.id, v.id));
    }
    const o = (await call('GET', '/api/admin/overview')).json();
    expect(o.signals.sharedDevices).toEqual([{ device: 'abcdef', visitors: 3 }]);
  });

  it('changes the Blind Hour mode and reveals categories, and the TV frame follows', async () => {
    const call = ctx.as(await admin());
    const { c1 } = await seeded();
    const display = await ctx.app.displays.create('t', { adminId: null, label: 'test' });
    await call('POST', '/api/admin/results/mode', { body: { mode: 'REVEAL' } });
    const early = await ctx.app.results.frame();
    expect(early.mode).toBe('REVEAL');
    expect(early.categories.every((c) => c.sealed)).toBe(true);
    expect(
      (await call('POST', '/api/admin/results/reveal', { body: { categoryId: c1.id } })).json(),
    ).toEqual({
      categoryId: c1.id,
      changed: true,
    });
    const after = await ctx.app.results.frame();
    expect(after.categories.find((c) => c.id === c1.id)!.sealed).toBe(false);
    expect((await call('GET', '/api/admin/overview')).json().results.revealedCategoryIds).toEqual([
      c1.id,
    ]);
    expect(display.id).toBeTruthy();
    expect(
      (await call('POST', '/api/admin/results/mode', { body: { mode: 'NOPE' } })).statusCode,
    ).toBe(400);
  });

  it('reading live counts is free in LIVE mode and audited (once per five minutes) during the Blind Hour', async () => {
    const call = ctx.as(await admin());
    await seeded();
    const live = await call('GET', '/api/admin/results/live');
    expect(live.json()).toMatchObject({ mode: 'LIVE', audited: false });
    expect(live.json().categories[0].rows[0]).toMatchObject({ votes: 2 });
    expect(await audit('results.live.read')).toHaveLength(0);

    await call('POST', '/api/admin/results/mode', { body: { mode: 'FROZEN' } });
    for (let i = 0; i < 3; i++) {
      const r = await call('GET', '/api/admin/results/live');
      expect(r.json()).toMatchObject({ mode: 'FROZEN', audited: true });
    }
    expect(await audit('results.live.read')).toHaveLength(1);
  });
});

/* ═══════════════════ displays ═══════════════════ */

describe('TV displays', () => {
  it('creates a display, shows its pairing link once, pairs, and revokes', async () => {
    const call = ctx.as(await admin());
    const res = await call('POST', '/api/admin/displays', { body: { label: 'Main hall' } });
    expect(res.statusCode).toBe(200);
    const { display, pairingUrl } = res.json();
    expect(pairingUrl).toMatch(/^http:\/\/localhost:5173\/live#t=mcd_[A-Za-z0-9_-]{43}$/);
    expect(display).toMatchObject({ label: 'Main hall', online: false, revokedAt: null });

    const token = pairingUrl.split('#t=')[1];
    const pair = await ctx.anon('POST', '/api/display/pair', { body: { token } });
    expect(pair.statusCode).toBe(200);

    // The list never contains the token.
    const list = await call('GET', '/api/admin/displays');
    expect(JSON.stringify(list.json())).not.toContain(token);
    expect(list.json().displays).toHaveLength(1);

    expect((await call('DELETE', `/api/admin/displays/${display.id}`)).statusCode).toBe(200);
    expect((await call('DELETE', `/api/admin/displays/${display.id}`)).statusCode).toBe(404);
    expect((await ctx.anon('POST', '/api/display/pair', { body: { token } })).statusCode).toBe(401);
    expect((await call('GET', '/api/admin/displays')).json().displays[0].revokedAt).not.toBeNull();
    expect((await audit('display.create')).length).toBe(1);
    expect((await audit('display.revoke')).length).toBe(1);
    expect(JSON.stringify(await db.select().from(auditLog))).not.toContain(token);
  });
});

/* ═══════════════════ visitors ═══════════════════ */

describe('visitors', () => {
  it('lists masked names and phones only, newest first, paged, with an exact phone search', async () => {
    const call = ctx.as(await admin('ADMIN'));
    const made = [];
    for (let i = 0; i < 5; i++) {
      made.push(
        await visitor({
          name: `Layla Haddad${i}`,
          phone: `+9627912345${60 + i}`,
          consent: i === 0,
        }),
      );
      await new Promise((r) => setTimeout(r, 5));
    }
    const c = await category();
    const e = await exhibitor([c.id]);
    await castVote(made[4]!.id, c.id, e.id);
    const page1 = (await call('GET', '/api/admin/visitors?limit=2')).json();
    expect(page1.visitors.map((v: { votes: number }) => v.votes)).toEqual([1, 0]);
    expect(page1.total).toBe(5);
    expect(page1.visitors).toHaveLength(2);
    expect(page1.visitors[0].id).toBe(made[4]!.id);
    expect(page1.nextAfter).toBeTruthy();
    const page2 = (
      await call('GET', `/api/admin/visitors?limit=2&after=${encodeURIComponent(page1.nextAfter)}`)
    ).json();
    expect(page2.visitors.map((v: { id: string }) => v.id)).toEqual([made[2]!.id, made[1]!.id]);
    const page3 = (
      await call('GET', `/api/admin/visitors?limit=2&after=${encodeURIComponent(page2.nextAfter)}`)
    ).json();
    expect(page3.visitors).toHaveLength(1);
    expect(page3.nextAfter).toBeNull();

    const everything = JSON.stringify([page1, page2, page3]);
    expect(everything).not.toMatch(/Layla|Haddad|9627912345/);
    expect(page1.visitors[0]).toMatchObject({ name: 'L••• H•••', phone: '+962 7•• ••• 564' });

    // Search by phone, in any format a visitor may type.
    const found = (
      await call('GET', `/api/admin/visitors?phone=${encodeURIComponent('079 1234 560')}`)
    ).json();
    expect(found.visitors.map((v: { id: string }) => v.id)).toEqual([made[0]!.id]);
    expect(found.visitors[0].outreachConsent).toBe(true);
    expect((await call('GET', '/api/admin/visitors?phone=banana')).statusCode).toBe(400);
    expect((await call('GET', '/api/admin/visitors?after=nonsense')).statusCode).toBe(400);
  });

  it("blocking ends the visitor's sessions and refuses their votes; unblocking restores them", async () => {
    const call = ctx.as(await admin());
    await call('PATCH', '/api/admin/settings', {
      body: { votingStatus: 'OPEN', accessMode: 'OFF' },
    });
    const c = await category();
    const e = await exhibitor([c.id]);
    // A real visitor through the real sign-in flow.
    const reqOtp = await ctx.anon('POST', '/api/auth/otp/request', {
      body: {
        name: 'Omar Saleh',
        phone: '0791234999',
        voteConsent: true,
        outreachConsent: false,
        locale: 'en',
      },
    });
    const code = /(\d{6})/.exec(sent.at(-1)!)![1]!;
    const verify = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/otp/verify',
      remoteAddress: '127.0.0.1',
      payload: { challengeId: reqOtp.json().challengeId, code },
    });
    const cookies = Object.fromEntries(verify.cookies.map((k) => [k.name, k.value]));
    const vote = () =>
      ctx.app.inject({
        method: 'POST',
        url: '/api/votes',
        remoteAddress: '127.0.0.1',
        cookies,
        payload: { categoryId: c.id, exhibitorId: e.id },
      });
    const [row] = await db.select({ id: visitors.id }).from(visitors);
    const id = row!.id;

    expect(
      (await call('POST', `/api/admin/visitors/${id}/block`, { body: { blocked: true } })).json(),
    ).toEqual({ blocked: true });
    expect((await vote()).statusCode).toBe(401);
    expect(await audit('visitor.block')).toHaveLength(1);
    expect((await db.select().from(visitors))[0]!.isBlocked).toBe(true);

    await call('POST', `/api/admin/visitors/${id}/block`, { body: { blocked: false } });
    expect(await audit('visitor.unblock')).toHaveLength(1);
    // Their old session stays void (it was revoked): they sign in again with a new code.
    expect((await vote()).statusCode).toBe(401);

    // Force sign-out works on its own, too.
    const res = await call('POST', `/api/admin/visitors/${id}/sign-out`);
    expect(res.statusCode).toBe(200);
    expect(await audit('visitor.signout')).toHaveLength(1);
    expect((await call('POST', `/api/admin/visitors/${randomUUID()}/sign-out`)).statusCode).toBe(
      404,
    );
  });

  it('only a SUPER_ADMIN may read a real name and number, with a reason, and it is audited', async () => {
    const lower = ctx.as(await admin('ADMIN'));
    const boss = await admin('SUPER_ADMIN');
    const v = await visitor({ name: 'Layla Haddad', phone: '+962791234567' });
    const denied = await lower('POST', `/api/admin/visitors/${v.id}/reveal`, {
      body: { reason: 'curious' },
    });
    expect(denied.statusCode).toBe(403);
    expect(await audit('visitor.unmask')).toHaveLength(0);

    const call = ctx.as(boss);
    expect(
      (await call('POST', `/api/admin/visitors/${v.id}/reveal`, { body: {} })).statusCode,
    ).toBe(400);
    expect(
      (await call('POST', `/api/admin/visitors/${v.id}/reveal`, { body: { reason: 'x' } }))
        .statusCode,
    ).toBe(400);
    const ok = await call('POST', `/api/admin/visitors/${v.id}/reveal`, {
      body: { reason: 'prize winner call' },
    });
    expect(ok.json()).toEqual({ name: 'Layla Haddad', phone: '+962791234567' });
    const [entry] = await audit('visitor.unmask');
    expect(entry).toMatchObject({ actorAdminId: boss.id, entityId: v.id });
    expect(entry!.details).toEqual({ reason: 'prize winner call' });
    expect(JSON.stringify(entry)).not.toMatch(/Layla|9627912/);
  });

  it("clears a victim's OTP throttle so they can ask for a code again", async () => {
    const call = ctx.as(await admin());
    await call('PATCH', '/api/admin/settings', { body: { accessMode: 'OFF' } });
    const body = {
      name: 'Omar Saleh',
      phone: '0791234888',
      voteConsent: true,
      outreachConsent: false,
      locale: 'en',
    };
    const send = () => ctx.anon('POST', '/api/auth/otp/request', { body });
    expect((await send()).statusCode).toBe(200);
    const again = await send();
    expect(again.statusCode).toBeGreaterThanOrEqual(400); // inside the resend cooldown
    const cleared = await call('POST', '/api/admin/otp-throttle/clear', {
      body: { phone: '+962791234888' },
    });
    expect(cleared.json()).toEqual({ cleared: 1 });
    expect((await send()).statusCode).toBe(200);
    const [entry] = await audit('otp.throttle.clear');
    expect(JSON.stringify(entry)).not.toContain('791234888');
    expect(entry!.entityId).toBe('+962 7•• ••• 888');
    expect(
      (await call('POST', '/api/admin/otp-throttle/clear', { body: { phone: '12' } })).statusCode,
    ).toBe(400);
    expect(
      (await call('POST', '/api/admin/otp-throttle/clear', { body: { phone: '+15551234567' } }))
        .statusCode,
    ).toBe(400);
  });
});

/* ═══════════════════ export ═══════════════════ */

describe('export', () => {
  async function world() {
    const [c1, c2] = [
      await category({ nameEn: 'Best Robot' }),
      await category({ nameEn: 'Best App' }),
    ];
    const e1 = await exhibitor([c1.id, c2.id], { nameEn: 'Atlas', booth: 'A1' });
    const e2 = await exhibitor([c1.id], { nameEn: '=HYPERLINK("http://evil","x")' });
    const e3 = await exhibitor([c1.id], { nameEn: 'Zeta' });
    const [p1, p2, p3] = [
      await visitor({ consent: true, name: 'Layla Haddad' }),
      await visitor({ consent: false, name: 'Omar Saleh' }),
      await visitor({ consent: true, blocked: true, name: 'Blocked Person' }),
    ];
    await castVote(p1.id, c1.id, e1.id);
    await castVote(p2.id, c1.id, e1.id);
    await castVote(p3.id, c1.id, e2.id);
    await castVote(p1.id, c2.id, e1.id);
    return { c1, c2, e1, e2, e3, p1, p2, p3 };
  }
  const download = async (kind: string, role: AdminRole = 'ADMIN') => {
    const res = await ctx.as(await admin(role))('GET', `/api/admin/export/${kind}`);
    return { res, text: res.body.replace(/^\uFEFF/, '') };
  };

  it('results: every exhibitor in every category, with competition ranks, matching the database', async () => {
    await world();
    const { res, text } = await download('results');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="mc2026-results-\d{8}-\d{4}\.csv"$/,
    );
    expect(res.body.startsWith('\uFEFF')).toBe(true);
    const lines = text.trim().split('\r\n');
    expect(lines[0]).toBe('category,rank,exhibitor,exhibitor_ar,booth,votes,active');
    const rows = lines.slice(1);
    expect(rows).toHaveLength(4); // 3 in Best Robot + 1 in Best App
    const robot = rows.filter((r) => r.startsWith('Best Robot'));
    expect(robot[0]).toBe('Best Robot,1,Atlas,,A1,2,true');
    expect(robot[1]!.startsWith('Best Robot,2,"\'=HYPERLINK(')).toBe(true);
    expect(robot[2]).toBe('Best Robot,3,Zeta,,,0,true');
    // Total votes in the file equal the votes table.
    const total = rows.reduce((n, r) => n + Number(/,(\d+),(true|false)$/.exec(r)![1]), 0);
    expect(total).toBe(await db.$count(votes));
    expect((await audit('export.run'))[0]!.details).toEqual({ kind: 'results', rows: 4 });
  });

  it('votes: a ledger with no names, phones or visitor ids, but a stable reference per voter', async () => {
    const w = await world();
    const { text } = await download('votes');
    const lines = text.trim().split('\r\n');
    expect(lines).toHaveLength(1 + 4);
    expect(text).not.toMatch(/Layla|Omar|Blocked|\+962|7912/);
    for (const v of [w.p1, w.p2, w.p3]) expect(text).not.toContain(v.id);
    const refs = lines.slice(1).map((l) => l.split(',')[2]);
    // p1 voted twice: same reference twice, and the other voters differ.
    expect(refs.filter((r) => r === refs[0]).length).toBe(2);
    expect(new Set(refs).size).toBe(3);
  });

  it('outreach: only visitors who agreed to be contacted and are not blocked, phone as a plain number', async () => {
    await world();
    const { text } = await download('outreach');
    const lines = text.trim().split('\r\n');
    expect(lines[0]).toBe('name,phone,locale,consented_at,registered_at,votes_cast');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^Layla Haddad,\+96279\d{7},ar,/);
    expect(lines[1]).not.toContain("'+");
    expect(text).not.toMatch(/Omar Saleh|Blocked Person/);
    expect(lines[1]!.endsWith(',2')).toBe(true);
  });

  it('neutralises spreadsheet formulas in names from strangers', async () => {
    await visitor({ consent: true, name: "=cmd|' /C calc'!A0" });
    await visitor({ consent: true, name: '@SUM(1+1)' });
    await visitor({ consent: true, name: '+1+1' });
    const { text } = await download('outreach');
    const names = text
      .trim()
      .split('\r\n')
      .slice(1)
      .map((l) => l.split(',')[0]!);
    for (const n of names) expect(n).toMatch(/^"?'/);
  });

  it('is available to ADMIN and SUPER_ADMIN, refuses a bad kind, and needs a session', async () => {
    expect((await download('results', 'SUPER_ADMIN')).res.statusCode).toBe(200);
    expect((await download('everything')).res.statusCode).toBe(400);
    expect((await ctx.anon('GET', '/api/admin/export/results')).statusCode).toBe(401);
  });

  it('csv cells: formulas, quotes, numbers and phones', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+cmd')).toBe("'+cmd");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@x')).toBe("'@x");
    expect(csvCell('\tx')).toBe("'\tx");
    expect(csvCell('+962791234567')).toBe('+962791234567');
    expect(csvCell('+962791234567x')).toBe("'+962791234567x");
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(1.5)).toBe('1.5');
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell('=a,b')).toBe(`"'=a,b"`);
    expect(csvCell(null)).toBe('');
    expect(csvCell(true)).toBe('true');
    expect(toCsv(['a'], [['x']])).toBe('\uFEFFa\r\nx\r\n');
  });
});

/* ═══════════════════ SMS inbox and roles ═══════════════════ */

describe('demo SMS inbox and the role split', () => {
  it('shows the latest messages to a SUPER_ADMIN only (they contain one-time codes)', async () => {
    await db.insert(smsOutbox).values([
      { toMasked: '+962 7•• ••• 111', body: 'Your code: 123456' },
      { toMasked: '+962 7•• ••• 222', body: 'Your code: 654321' },
    ]);
    const boss = ctx.as(await admin('SUPER_ADMIN'));
    const res = await boss('GET', '/api/admin/sms-inbox');
    expect(res.json().messages).toHaveLength(2);
    expect(res.json().messages[0].body).toMatch(/Your code/);
    const lower = ctx.as(await admin('ADMIN'));
    expect((await lower('GET', '/api/admin/sms-inbox')).statusCode).toBe(403);
  });

  it('an ADMIN can run the event but not manage accounts, read the audit log or unmask people', async () => {
    const lower = ctx.as(await admin('ADMIN'));
    for (const [method, url] of [
      ['GET', '/api/admin/overview'],
      ['GET', '/api/admin/content'],
      ['GET', '/api/admin/settings'],
      ['GET', '/api/admin/displays'],
      ['GET', '/api/admin/visitors'],
      ['GET', '/api/admin/export/results'],
      ['GET', '/api/admin/results/live'],
    ] as const)
      expect((await lower(method, url)).statusCode, url).toBe(200);
    for (const [method, url] of [
      ['GET', '/api/admin/users'],
      ['GET', '/api/admin/audit'],
      ['GET', '/api/admin/sms-inbox'],
    ] as const)
      expect((await lower(method, url)).statusCode, url).toBe(403);
  });

  it('every change needs the CSRF token', async () => {
    const a = await admin();
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/admin/settings',
      remoteAddress: '127.0.0.1',
      cookies: { [COOKIE]: a.cookie },
      payload: { eventName: 'Hijacked' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CSRF_FAILED');
    const photo = await ctx.app.inject({
      method: 'PUT',
      url: `/api/admin/exhibitors/${randomUUID()}/photo`,
      remoteAddress: '127.0.0.1',
      cookies: { [COOKIE]: a.cookie },
      headers: { 'content-type': 'image/webp' },
      payload: webp(),
    });
    expect(photo.statusCode).toBe(403);
  });
});
