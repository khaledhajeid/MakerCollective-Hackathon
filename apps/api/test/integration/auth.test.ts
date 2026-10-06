import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { otpChallenges, settings, visitors } from '../../src/db/schema.js';
import type { SmsProvider } from '../../src/modules/sms/provider.js';
import { testEnv } from '../helpers.js';
import { openTestDb } from './db.js';

const { pool, db, reset } = openTestDb();
afterAll(() => pool.end());

const VENUE_IP = '203.0.113.50';
const OUTSIDE_IP = '198.51.100.9';
const PHONE = '0791234567';

let sent: { toE164: string; text: string }[];
const sms: SmsProvider = {
  name: 'console',
  async send(m) {
    sent.push({ toE164: m.toE164, text: m.text });
  },
};

async function makeApp(over: Record<string, string> = {}) {
  const app = await buildApp({
    env: testEnv({ TRUST_PROXY: '172.28.0.10', ...over }),
    db,
    redis: null,
    sms,
  });
  const call = (
    method: 'GET' | 'POST',
    url: string,
    opts: {
      ip?: string;
      body?: unknown;
      cookies?: Record<string, string>;
      headers?: Record<string, string>;
    } = {},
  ) =>
    app.inject({
      method,
      url,
      remoteAddress: '172.28.0.10',
      headers: { 'x-forwarded-for': opts.ip ?? VENUE_IP, ...opts.headers },
      cookies: opts.cookies,
      payload: opts.body as object | undefined,
    });
  return { app, call };
}

const reg = (over = {}) => ({
  name: 'Layla Haddad',
  phone: PHONE,
  voteConsent: true,
  outreachConsent: false,
  locale: 'en',
  ...over,
});
const lastCode = () => /(\d{6})/.exec(sent.at(-1)!.text)![1]!;
const cookieJar = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

beforeEach(async () => {
  sent = [];
  await reset();
  await db
    .update(settings)
    .set({ accessMode: 'IP_ALLOWLIST', venueCidrs: ['203.0.113.0/24'], wifiSsid: 'MC2026' });
});

describe('venue gate on credential endpoints (F10/F11)', () => {
  it('refuses OTP requests from outside the venue and sends no SMS', async () => {
    const { call } = await makeApp();
    const res = await call('POST', '/api/auth/otp/request', { ip: OUTSIDE_IP, body: reg() });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NOT_ON_VENUE_NETWORK');
    expect(res.json().error.details).toEqual({ wifiSsid: 'MC2026' });
    expect(sent).toHaveLength(0);
    expect(await db.$count(otpChallenges)).toBe(0);
  });

  it('refuses verification from outside the venue even with a valid code', async () => {
    const { call } = await makeApp();
    const r = await call('POST', '/api/auth/otp/request', { body: reg() });
    const res = await call('POST', '/api/auth/otp/verify', {
      ip: OUTSIDE_IP,
      body: { challengeId: r.json().challengeId, code: lastCode() },
    });
    expect(res.json().error.code).toBe('NOT_ON_VENUE_NETWORK');
    expect(await db.$count(visitors)).toBe(0);
  });

  it('cannot be bypassed with forged proxy headers', async () => {
    const { call } = await makeApp();
    const res = await call('POST', '/api/auth/otp/request', {
      ip: OUTSIDE_IP,
      body: reg(),
      headers: { 'cf-connecting-ip': VENUE_IP, 'x-real-ip': VENUE_IP, 'true-client-ip': VENUE_IP },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('OTP happy path (F5/F6)', () => {
  it('sends a code, verifies it, creates the visitor, and issues a signed HttpOnly session', async () => {
    const { call } = await makeApp();
    const r = await call('POST', '/api/auth/otp/request', { body: reg() });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ maskedPhone: '+962 7•• ••• 567', expiresInSeconds: 300 });
    expect(sent[0]!.toE164).toBe('+962791234567');
    expect(sent[0]!.text).toMatch(/@localhost:5173 #\d{6}$/); // WebOTP origin binding

    const v = await call('POST', '/api/auth/otp/verify', {
      body: { challengeId: r.json().challengeId, code: lastCode() },
    });
    expect(v.statusCode).toBe(200);
    expect(v.json().visitor).toEqual({
      name: 'Layla Haddad',
      maskedPhone: '+962 7•• ••• 567',
      locale: 'en',
    });
    const session = v.cookies.find((c) => c.name === 'mc_session')!;
    expect(session).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });

    const me = await call('GET', '/api/auth/session', { cookies: cookieJar(v) });
    expect(me.json()).toMatchObject({ authenticated: true, visitor: { name: 'Layla Haddad' } });
  });

  it('stores name and phone only as ciphertext (F14)', async () => {
    const { call } = await makeApp();
    const r = await call('POST', '/api/auth/otp/request', { body: reg() });
    await call('POST', '/api/auth/otp/verify', {
      body: { challengeId: r.json().challengeId, code: lastCode() },
    });
    const [row] = await db.select().from(visitors);
    for (const col of [row!.nameEnc, row!.phoneEnc]) expect(col).toMatch(/^v1\./);
    expect(JSON.stringify(row)).not.toContain('Layla');
    expect(JSON.stringify(row)).not.toContain('791234567');
    expect(row!.phoneHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('identifies one person across phone formats and Arabic digits (F12)', async () => {
    const { call } = await makeApp();
    for (const phone of ['0791234567', '+962 79 123 4567', '00962791234567', '٠٧٩١٢٣٤٥٦٧']) {
      await db.update(otpChallenges).set({ createdAt: new Date(Date.now() - 3_600_000) }); // skip cooldown
      const r = await call('POST', '/api/auth/otp/request', {
        body: reg({ phone }),
        headers: { cookie: `mc_device=${'x'.repeat(21)}${phone.length}` },
      });
      expect(r.statusCode, phone).toBe(200);
      const v = await call('POST', '/api/auth/otp/verify', {
        body: { challengeId: r.json().challengeId, code: lastCode() },
      });
      expect(v.statusCode, phone).toBe(200);
    }
    expect(await db.$count(visitors)).toBe(1);
  });

  it('accepts an Arabic-Indic OTP the visitor typed on an Arabic keyboard', async () => {
    const { call } = await makeApp();
    const r = await call('POST', '/api/auth/otp/request', { body: reg() });
    const arabic = lastCode().replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));
    const v = await call('POST', '/api/auth/otp/verify', {
      body: { challengeId: r.json().challengeId, code: arabic },
    });
    expect(v.statusCode).toBe(200);
  });

  it('records outreach consent separately and only when given', async () => {
    const { call } = await makeApp();
    const r = await call('POST', '/api/auth/otp/request', { body: reg({ outreachConsent: true }) });
    await call('POST', '/api/auth/otp/verify', {
      body: { challengeId: r.json().challengeId, code: lastCode() },
    });
    const [row] = await db.select().from(visitors);
    expect(row!.voteConsentAt).toBeTruthy();
    expect(row!.outreachConsentAt).toBeTruthy();
    expect(row!.consentVersion).toBe('2026-10-v1');
  });
});

describe('consent and phone rules (F5, F14, SMS-pumping control)', () => {
  it('requires voting consent', async () => {
    const { call } = await makeApp();
    const res = await call('POST', '/api/auth/otp/request', { body: reg({ voteConsent: false }) });
    expect(res.json().error.code).toBe('CONSENT_REQUIRED');
    expect(sent).toHaveLength(0);
  });

  it.each([
    ['foreign number', '+14155550123'],
    ['Jordan landline', '065355000'],
    ['garbage', 'hello'],
    ['premium-looking', '+9629000000'],
  ])('refuses %s without sending an SMS', async (_label, phone) => {
    const { call } = await makeApp();
    const res = await call('POST', '/api/auth/otp/request', { body: reg({ phone }) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toMatch(/PHONE_NOT_ALLOWED|VALIDATION_FAILED/);
    expect(sent).toHaveLength(0);
  });
});

describe('OTP abuse resistance', () => {
  it('locks the challenge after the maximum wrong attempts, even for the correct code afterwards', async () => {
    const { call } = await makeApp();
    const r = await call('POST', '/api/auth/otp/request', { body: reg() });
    const challengeId = r.json().challengeId;
    const good = lastCode();
    const wrong = good === '000000' ? '111111' : '000000';
    const codes: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await call('POST', '/api/auth/otp/verify', {
        body: { challengeId, code: wrong },
      });
      codes.push(res.json().error.code);
      expect(res.json().error.details.attemptsRemaining).toBe(4 - i);
    }
    expect(codes.every((c) => c === 'OTP_INVALID')).toBe(true);
    const locked = await call('POST', '/api/auth/otp/verify', {
      body: { challengeId, code: good },
    });
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe('OTP_LOCKED');
    expect(await db.$count(visitors)).toBe(0);
  });

  it('50 parallel guesses can never exceed the attempt cap', async () => {
    const { call } = await makeApp();
    const r = await call('POST', '/api/auth/otp/request', { body: reg() });
    const challengeId = r.json().challengeId;
    const good = lastCode();
    const guesses = Array.from({ length: 50 }, (_, i) => String(i).padStart(6, '0')).filter(
      (g) => g !== good,
    );
    const results = await Promise.all(
      guesses.map((code) => call('POST', '/api/auth/otp/verify', { body: { challengeId, code } })),
    );
    const evaluated = results.filter((x) => x.json().error.code === 'OTP_INVALID').length;
    expect(evaluated).toBe(5); // exactly otpMaxAttempts guesses were ever compared
    const [c] = await db.select().from(otpChallenges).where(eq(otpChallenges.id, challengeId));
    expect(c!.attempts).toBe(5);
  });

  it('throttles resend inside the cooldown and reports how long to wait', async () => {
    const { call } = await makeApp();
    await call('POST', '/api/auth/otp/request', { body: reg() });
    const again = await call('POST', '/api/auth/otp/request', { body: reg() });
    expect(again.statusCode).toBe(429);
    expect(again.json().error.code).toBe('OTP_RESEND_TOO_SOON');
    expect(again.json().error.details.retryAfterSeconds).toBeGreaterThan(0);
    expect(sent).toHaveLength(1);
  });

  it('impatient re-taps during the cooldown do not burn the hourly quota', async () => {
    const { call } = await makeApp();
    await call('POST', '/api/auth/otp/request', { body: reg() });
    for (let i = 0; i < 12; i++) {
      const res = await call('POST', '/api/auth/otp/request', { body: reg() });
      expect(res.json().error.code).toBe('OTP_RESEND_TOO_SOON');
    }
    await db.update(otpChallenges).set({ createdAt: new Date(Date.now() - 3_600_000) });
    const later = await call('POST', '/api/auth/otp/request', { body: reg() });
    expect(later.statusCode).toBe(200);
  });

  it('parallel requests for one phone send exactly one SMS (advisory lock)', async () => {
    const { call } = await makeApp();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => call('POST', '/api/auth/otp/request', { body: reg() })),
    );
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it('a new code retires the previous one', async () => {
    const { call } = await makeApp();
    const first = await call('POST', '/api/auth/otp/request', { body: reg() });
    const firstCode = lastCode();
    await db.update(otpChallenges).set({ createdAt: new Date(Date.now() - 3_600_000) });
    await call('POST', '/api/auth/otp/request', { body: reg() });
    const old = await call('POST', '/api/auth/otp/verify', {
      body: { challengeId: first.json().challengeId, code: firstCode },
    });
    expect(old.json().error.code).toBe('OTP_EXPIRED');
  });

  it('a code works exactly once', async () => {
    const { call } = await makeApp();
    const r = await call('POST', '/api/auth/otp/request', { body: reg() });
    const body = { challengeId: r.json().challengeId, code: lastCode() };
    const results = await Promise.all([
      call('POST', '/api/auth/otp/verify', { body }),
      call('POST', '/api/auth/otp/verify', { body }),
    ]);
    expect(results.filter((x) => x.statusCode === 200)).toHaveLength(1);
  });

  it('rejects expired codes', async () => {
    const { call } = await makeApp();
    const r = await call('POST', '/api/auth/otp/request', { body: reg() });
    await db.update(otpChallenges).set({ expiresAt: new Date(Date.now() - 1000) });
    const v = await call('POST', '/api/auth/otp/verify', {
      body: { challengeId: r.json().challengeId, code: lastCode() },
    });
    expect(v.json().error.code).toBe('OTP_EXPIRED');
  });

  it('rolls the challenge back when the SMS gateway fails, so the visitor can retry at once', async () => {
    const failing: SmsProvider = {
      name: 'http',
      send: async () => {
        throw new Error('gateway down');
      },
    };
    const app = await buildApp({
      env: testEnv({ TRUST_PROXY: '172.28.0.10' }),
      db,
      redis: null,
      sms: failing,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/otp/request',
      remoteAddress: '172.28.0.10',
      headers: { 'x-forwarded-for': VENUE_IP },
      payload: reg(),
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('SMS_UNAVAILABLE');
    expect(await db.$count(otpChallenges)).toBe(0);
  });

  it('applies the per-phone hourly cap across devices', async () => {
    const { call } = await makeApp();
    let last = 0;
    for (let i = 0; i < 6; i++) {
      await db.update(otpChallenges).set({ createdAt: new Date(Date.now() - 3_600_000) });
      const res = await call('POST', '/api/auth/otp/request', {
        body: reg(),
        headers: { cookie: `mc_device=${String(i).repeat(22)}` },
      });
      last = res.statusCode;
    }
    expect(last).toBe(429);
    expect(sent).toHaveLength(5);
  });

  it('requests refused by the cooldown never spend the shared venue/global budget', async () => {
    const { call } = await makeApp({ OTP_GLOBAL_PER_HOUR: '10' });
    await call('POST', '/api/auth/otp/request', { body: reg() });
    for (let i = 0; i < 40; i++) {
      const res = await call('POST', '/api/auth/otp/request', { body: reg() });
      expect(res.json().error.code).toBe('OTP_RESEND_TOO_SOON');
    }
    // Another visitor on the same venue IP is unaffected.
    const other = await call('POST', '/api/auth/otp/request', {
      body: reg({ phone: '0797654321' }),
    });
    expect(other.statusCode).toBe(200);
  });

  it('a gateway failure keeps the visitor’s earlier valid code usable', async () => {
    const { call } = await makeApp();
    const first = await call('POST', '/api/auth/otp/request', { body: reg() });
    const firstCode = lastCode();
    await db.update(otpChallenges).set({ createdAt: new Date(Date.now() - 3_600_000) });
    const failing: SmsProvider = {
      name: 'http',
      send: async () => {
        throw new Error('gateway down');
      },
    };
    const bad = await buildApp({
      env: testEnv({ TRUST_PROXY: '172.28.0.10' }),
      db,
      redis: null,
      sms: failing,
    });
    const res = await bad.inject({
      method: 'POST',
      url: '/api/auth/otp/request',
      remoteAddress: '172.28.0.10',
      headers: { 'x-forwarded-for': VENUE_IP },
      payload: reg(),
    });
    expect(res.statusCode).toBe(502);
    const v = await call('POST', '/api/auth/otp/verify', {
      body: { challengeId: first.json().challengeId, code: firstCode },
    });
    expect(v.statusCode).toBe(200);
  });

  it('applies the global hourly SMS ceiling (cost/pumping control)', async () => {
    const { call } = await makeApp({ OTP_GLOBAL_PER_HOUR: '10' });
    let ok = 0;
    for (let i = 0; i < 12; i++) {
      const phone = `07912345${String(i).padStart(2, '0')}`;
      const res = await call('POST', '/api/auth/otp/request', {
        body: reg({ phone }),
        headers: { cookie: `mc_device=${String.fromCharCode(97 + i).repeat(22)}` },
      });
      if (res.statusCode === 200) ok++;
    }
    expect(ok).toBe(10);
  });
});

describe('visitor sessions', () => {
  it('rejects a tampered, malformed or missing session cookie', async () => {
    const { call } = await makeApp();
    const r = await call('POST', '/api/auth/otp/request', { body: reg() });
    const v = await call('POST', '/api/auth/otp/verify', {
      body: { challengeId: r.json().challengeId, code: lastCode() },
    });
    const good = cookieJar(v).mc_session!;
    const forged = good.replace(/^[^.]+/, '00000000-0000-4000-8000-000000000000');
    for (const cookie of [forged, good.slice(0, -3) + 'abc', 'garbage', '']) {
      const me = await call('GET', '/api/auth/session', { cookies: { mc_session: cookie } });
      expect(me.json().authenticated, cookie).toBe(false);
    }
    expect((await call('GET', '/api/auth/session')).json().authenticated).toBe(false);
  });

  it('kills existing sessions of a blocked visitor and gives blocked numbers a silent decoy', async () => {
    const { call } = await makeApp();
    const r = await call('POST', '/api/auth/otp/request', { body: reg() });
    const v = await call('POST', '/api/auth/otp/verify', {
      body: { challengeId: r.json().challengeId, code: lastCode() },
    });
    await db.update(visitors).set({ isBlocked: true });
    expect(
      (await call('GET', '/api/auth/session', { cookies: cookieJar(v) })).json().authenticated,
    ).toBe(false);
    await db.update(otpChallenges).set({ createdAt: new Date(Date.now() - 3_600_000) });
    sent = [];
    // Looks identical to success (no enumeration of blocked numbers) but nothing is sent or spent.
    const r2 = await call('POST', '/api/auth/otp/request', { body: reg() });
    expect(r2.statusCode).toBe(200);
    expect(sent).toHaveLength(0);
    const v2 = await call('POST', '/api/auth/otp/verify', {
      body: { challengeId: r2.json().challengeId, code: '123456' },
    });
    expect(v2.json().error.code).toBe('OTP_INVALID');
  });

  it('refuses a blocked visitor at sign-in if they were blocked between request and verify', async () => {
    const { call } = await makeApp();
    const r = await call('POST', '/api/auth/otp/request', { body: reg() });
    const first = await call('POST', '/api/auth/otp/verify', {
      body: { challengeId: r.json().challengeId, code: lastCode() },
    });
    expect(first.statusCode).toBe(200);
    await db.update(otpChallenges).set({ createdAt: new Date(Date.now() - 3_600_000) });
    const r2 = await call('POST', '/api/auth/otp/request', { body: reg() });
    await db.update(visitors).set({ isBlocked: true });
    const v2 = await call('POST', '/api/auth/otp/verify', {
      body: { challengeId: r2.json().challengeId, code: lastCode() },
    });
    expect(v2.statusCode).toBe(403);
    expect(v2.json().error.code).toBe('VISITOR_BLOCKED');
  });

  it('logout revokes the session server-side: a captured cookie stops working', async () => {
    const { call } = await makeApp();
    const r = await call('POST', '/api/auth/otp/request', { body: reg() });
    const v = await call('POST', '/api/auth/otp/verify', {
      body: { challengeId: r.json().challengeId, code: lastCode() },
    });
    const captured = cookieJar(v);
    expect(
      (await call('GET', '/api/auth/session', { cookies: captured })).json().authenticated,
    ).toBe(true);
    await call('POST', '/api/auth/logout', { cookies: captured });
    expect(
      (await call('GET', '/api/auth/session', { cookies: captured })).json().authenticated,
    ).toBe(false);
    // Signing in again afterwards works (new session is newer than the revocation).
    await db.update(otpChallenges).set({ createdAt: new Date(Date.now() - 3_600_000) });
    const r2 = await call('POST', '/api/auth/otp/request', { body: reg() });
    const v2 = await call('POST', '/api/auth/otp/verify', {
      body: { challengeId: r2.json().challengeId, code: lastCode() },
    });
    expect(
      (await call('GET', '/api/auth/session', { cookies: cookieJar(v2) })).json().authenticated,
    ).toBe(true);
  });

  it('re-verification after a consent-version bump moves version and timestamp together', async () => {
    const { app, call } = await makeApp();
    const r = await call('POST', '/api/auth/otp/request', { body: reg() });
    await call('POST', '/api/auth/otp/verify', {
      body: { challengeId: r.json().challengeId, code: lastCode() },
    });
    const [before] = await db.select().from(visitors);
    await new Promise((res) => setTimeout(res, 20));
    await db.update(settings).set({ consentVersion: '2026-10-v2' });
    app.settings.invalidate();
    await db.update(otpChallenges).set({ createdAt: new Date(Date.now() - 3_600_000) });
    const r2 = await call('POST', '/api/auth/otp/request', { body: reg() });
    await call('POST', '/api/auth/otp/verify', {
      body: { challengeId: r2.json().challengeId, code: lastCode() },
    });
    const [after] = await db.select().from(visitors);
    expect(after!.consentVersion).toBe('2026-10-v2');
    expect(after!.voteConsentAt.getTime()).toBeGreaterThan(before!.voteConsentAt.getTime());
  });

  it('sets Secure cookies when the public origin is https', async () => {
    const { call } = await makeApp({ PUBLIC_ORIGIN: 'https://vote.example.org' });
    const r = await call('POST', '/api/auth/otp/request', { body: reg() });
    const v = await call('POST', '/api/auth/otp/verify', {
      body: { challengeId: r.json().challengeId, code: lastCode() },
    });
    expect(v.cookies.find((c) => c.name === 'mc_session')).toMatchObject({ secure: true });
    expect(v.cookies.find((c) => c.name === 'mc_device')).toMatchObject({
      secure: true,
      httpOnly: true,
    });
  });

  it('accepts a body-less POST that carries a JSON content-type (what browsers send for logout)', async () => {
    const { call } = await makeApp();
    const res = await call('POST', '/api/auth/logout', {
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('still rejects malformed JSON with a 400', async () => {
    const { app } = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/otp/request',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': VENUE_IP },
      remoteAddress: '172.28.0.10',
      payload: '{nope',
    });
    expect(res.statusCode).toBe(400);
  });

  it('logout clears the session cookie', async () => {
    const { call } = await makeApp();
    const res = await call('POST', '/api/auth/logout');
    expect(res.cookies.find((c) => c.name === 'mc_session')?.value).toBe('');
  });
});

describe('CSRF origin guard', () => {
  it('rejects cross-origin and cross-site state-changing requests', async () => {
    const { call } = await makeApp();
    const attacks: Record<string, string>[] = [
      { origin: 'https://evil.example' },
      { 'sec-fetch-site': 'cross-site' },
    ];
    for (const headers of attacks) {
      const res = await call('POST', '/api/auth/otp/request', { body: reg(), headers });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('CSRF_FAILED');
    }
    expect(sent).toHaveLength(0);
  });

  it('accepts the configured origin', async () => {
    const { call } = await makeApp();
    const res = await call('POST', '/api/auth/otp/request', {
      body: reg(),
      headers: { origin: 'http://localhost:5173', 'sec-fetch-site': 'same-origin' },
    });
    expect(res.statusCode).toBe(200);
  });
});
