import { argon2Sync, randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from '@fastify/type-provider-zod';
import cookie from '@fastify/cookie';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { AdminRole } from '@mc/shared';
import { buildApp } from '../../src/app.js';
import { adminRecoveryCodes, adminSessions, adminUsers, auditLog } from '../../src/db/schema.js';
import { FieldCipher, sha256Hex } from '../../src/lib/crypto.js';
import { errorsPlugin } from '../../src/plugins/errors.js';
import { adminGuard } from '../../src/modules/admin/guard.js';
import { hashPassword } from '../../src/modules/admin/password.js';
import { PERMISSIONS, can, type Access } from '../../src/modules/admin/permissions.js';
import { AdminSessions, IDLE_MS, PENDING_MS } from '../../src/modules/admin/sessions.js';
import { base32Decode, generateTotpSecret, hotp, stepAt } from '../../src/modules/admin/totp.js';
import { testEnv } from '../helpers.js';
import { openTestDb } from './db.js';

const { pool, db, reset } = openTestDb();
afterAll(() => pool.end());

const T0 = new Date('2026-10-08T06:00:00.000Z');
const PASSWORD = 'correct-horse-battery-1';
const COOKIE = 'mc_admin';
const cli = { adminId: null, label: 'cli:test' };

let clock: Date;
const advance = (ms: number) => {
  clock = new Date(clock.getTime() + ms);
};

let passwordHash: string;
const env = testEnv();
const cipher = new FieldCipher(env.PII_ENCRYPTION_KEY);

type App = Awaited<ReturnType<typeof makeApp>>;
async function makeApp(over: Record<string, string> = {}) {
  const appEnv = over && Object.keys(over).length ? testEnv(over) : env;
  const app = await buildApp({ env: appEnv, db, redis: null, clock: () => clock });
  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    o: {
      cookie?: string;
      csrf?: string;
      body?: unknown;
      ip?: string;
      headers?: Record<string, string>;
    } = {},
  ) =>
    app.inject({
      method,
      url,
      remoteAddress: o.ip ?? '127.0.0.1',
      headers: { ...(o.csrf ? { 'x-csrf-token': o.csrf } : {}), ...o.headers },
      cookies: o.cookie ? { [COOKIE]: o.cookie } : undefined,
      payload: o.body as object | undefined,
    });
  return { app, call };
}

let ctx: App;
beforeEach(async () => {
  clock = new Date(T0);
  await reset();
  passwordHash ??= await hashPassword(PASSWORD);
  ctx = await makeApp();
});

/* ───────────── fixtures ───────────── */

interface Seeded {
  id: string;
  username: string;
  password: string;
  secret: string;
}
let seq = 0;
async function seed(
  o: {
    username?: string;
    role?: AdminRole;
    mfa?: boolean;
    mustChange?: boolean;
    credentialsExpireAt?: Date;
  } = {},
): Promise<Seeded> {
  const username = o.username ?? `admin${++seq}`;
  const secret = generateTotpSecret();
  const mfa = o.mfa ?? true;
  const [row] = await db
    .insert(adminUsers)
    .values({
      username,
      passwordHash,
      role: o.role ?? 'SUPER_ADMIN',
      mfaEnabled: mfa,
      totpSecretEnc: mfa ? cipher.encrypt(secret, 'admin.totp') : null,
      mustChangePassword: o.mustChange ?? false,
      credentialsExpireAt: o.credentialsExpireAt ?? null,
    })
    .returning({ id: adminUsers.id });
  return { id: row!.id, username, password: PASSWORD, secret };
}

/** A valid code for a time-step later than any used so far (each code works once, so tests move the clock on). */
const nextCode = (secret: string) => {
  advance(31_000);
  return hotp(base32Decode(secret), stepAt(clock.getTime()));
};

const jar = (res: { cookies: { name: string; value: string }[] }) =>
  res.cookies.find((c) => c.name === COOKIE)?.value;

async function login(a: Seeded, password = a.password) {
  const res = await ctx.call('POST', '/api/admin/auth/login', {
    body: { username: a.username, password },
  });
  return {
    res,
    body: res.json(),
    cookie: jar(res),
    csrf: res.json().csrfToken as string | undefined,
  };
}

/** Password + authenticator code: a fully signed-in session. */
async function signIn(a: Seeded) {
  const first = await login(a);
  expect(first.res.statusCode).toBe(200);
  const res = await ctx.call('POST', '/api/admin/auth/mfa/verify', {
    cookie: first.cookie,
    csrf: first.csrf,
    body: { code: nextCode(a.secret) },
  });
  expect(res.statusCode).toBe(200);
  return { cookie: jar(res)!, csrf: res.json().session.csrfToken as string, res };
}

const audit = (action: string) => db.select().from(auditLog).where(eq(auditLog.action, action));
const adminRow = async (id: string) =>
  (await db.select().from(adminUsers).where(eq(adminUsers.id, id)))[0]!;

/* ═══════════════════ sign-in ═══════════════════ */

describe('sign-in', () => {
  it('password alone only buys a pending session that asks for the second factor', async () => {
    const a = await seed();
    const { res, body, cookie } = await login(a);
    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({
      authenticated: true,
      stage: 'mfa',
      admin: { username: a.username, role: 'SUPER_ADMIN' },
    });
    expect(JSON.stringify(body)).not.toMatch(/hash|argon|secret"/i);
    expect(cookie).toMatch(/^mca_[A-Za-z0-9_-]{43}$/);
    const set = res.cookies.find((c) => c.name === COOKIE)!;
    expect(set).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
    const [stored] = await db.select().from(adminSessions);
    expect(stored!.mfaVerified).toBe(false);
    expect(stored!.tokenHash).toBe(sha256Hex(cookie!)); // only the hash is stored
    expect(stored!.tokenHash).not.toContain(cookie!);
    expect(stored!.expiresAt.getTime() - clock.getTime()).toBe(PENDING_MS);
  });

  it('completes with a TOTP code, and the token is REPLACED (no session fixation)', async () => {
    const a = await seed();
    const first = await login(a);
    const res = await ctx.call('POST', '/api/admin/auth/mfa/verify', {
      cookie: first.cookie,
      csrf: first.csrf,
      body: { code: nextCode(a.secret) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().session).toMatchObject({ stage: 'ready' });
    const upgraded = jar(res)!;
    expect(upgraded).not.toBe(first.cookie);
    // The pre-MFA token is dead, not merely demoted.
    const old = await ctx.call('GET', '/api/admin/users', { cookie: first.cookie });
    expect(old.statusCode).toBe(401);
    const now = await ctx.call('GET', '/api/admin/users', { cookie: upgraded });
    expect(now.statusCode).toBe(200);
    expect((await audit('admin.login')).length).toBe(1);
    expect((await adminRow(a.id)).lastLoginAt).not.toBeNull();
  });

  it('answers wrong password, unknown user, disabled and locked accounts identically', async () => {
    const a = await seed();
    const disabled = await seed({ username: 'gone' });
    await db.update(adminUsers).set({ isDisabled: true }).where(eq(adminUsers.id, disabled.id));
    const t0 = Date.now();
    const unknown = await ctx.call('POST', '/api/admin/auth/login', {
      body: { username: 'nobody', password: 'whatever-it-is-123' },
    });
    // An unknown user still pays a full argon2 verification, so it is not measurably faster than a real one.
    expect(Date.now() - t0).toBeGreaterThan(40);
    const wrong = (await login(a, 'not-the-password-xyz')).res;
    const dis = (await login(disabled)).res;
    for (const r of [unknown, wrong, dis]) {
      expect(r.statusCode).toBe(401);
      expect(r.json()).toEqual({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Sign-in failed. Check your details and try again.',
        },
      });
      expect(r.cookies.find((c) => c.name === COOKIE)).toBeUndefined();
    }
    // Only a KNOWN account's failure is recorded (an unknown username is just noise, and may be a typed password).
    const failed = await audit('admin.login.failed');
    expect(failed.length).toBe(1);
    expect(failed[0]!.actorAdminId).toBe(a.id);
    expect(JSON.stringify(failed[0]!.details)).not.toContain('not-the-password');
  });

  it('locks sign-in after 5 wrong answers, longer each time, and a correct password does not bypass it', async () => {
    const a = await seed();
    for (let i = 0; i < 5; i++)
      expect((await login(a, `wrong-password-${i}-xx`)).res.statusCode).toBe(401);
    const row = await adminRow(a.id);
    expect(row.failedAttempts).toBe(5);
    expect(row.lockedUntil!.getTime() - clock.getTime()).toBe(5 * 60_000);
    expect((await audit('admin.account.locked')).length).toBe(1);

    // Right password, but locked: same refusal, and it never reaches a session.
    const locked = await login(a);
    expect(locked.res.statusCode).toBe(401);
    expect(locked.cookie).toBeUndefined();

    // The lock ends on its own.
    advance(5 * 60_000 + 1000);
    expect((await login(a)).res.statusCode).toBe(200);
  });

  it('each further lock is longer: 5 min, 10, 20, 40, then capped at an hour', async () => {
    const a = await seed();
    const minutesAt = async (attempts: number) => {
      // One wrong answer takes the counter to a multiple of five (the limiter, not the lock, is what we are not testing).
      await db
        .update(adminUsers)
        .set({ failedAttempts: attempts - 1, lockedUntil: null })
        .where(eq(adminUsers.id, a.id));
      ctx = await makeApp();
      await login(a, 'wrong-password-escalate');
      const row = await adminRow(a.id);
      return (row.lockedUntil!.getTime() - clock.getTime()) / 60_000;
    };
    expect(await minutesAt(5)).toBe(5);
    expect(await minutesAt(10)).toBe(10);
    expect(await minutesAt(15)).toBe(20);
    expect(await minutesAt(20)).toBe(40);
    expect(await minutesAt(25)).toBe(60);
    expect(await minutesAt(100)).toBe(60);
  });

  it('a lock-out never ends a session that is already fully signed in', async () => {
    const a = await seed();
    const s = await signIn(a);
    for (let i = 0; i < 5; i++) await login(a, `guess-number-${i}-xxx`);
    expect((await adminRow(a.id)).lockedUntil).not.toBeNull();
    const still = await ctx.call('GET', '/api/admin/auth/session', { cookie: s.cookie });
    expect(still.json()).toMatchObject({ authenticated: true, stage: 'ready' });
  });

  it('a correct password does NOT reset the failure counter (only a finished second factor does)', async () => {
    const a = await seed();
    for (let i = 0; i < 3; i++) await login(a, `wrong-password-${i}-xx`);
    expect((await login(a)).res.statusCode).toBe(200);
    expect((await adminRow(a.id)).failedAttempts).toBe(3);
    await signIn(a);
    expect((await adminRow(a.id)).failedAttempts).toBe(0);
  });

  it('rate-limits sign-in per ADDRESS before any hashing, and never per username', async () => {
    const a = await seed();
    // A burst against one real username from many addresses must not shut the real admin out: only the account
    // lock (5 wrong answers) applies per account, and it is a different, escapable mechanism.
    for (let i = 0; i < 4; i++)
      expect((await login(a, `wrong-password-${i}-yy`)).res.statusCode).toBe(401);
    const real = await ctx.call('POST', '/api/admin/auth/login', {
      body: { username: a.username, password: a.password },
      ip: '198.51.100.7', // a different address: not limited, and the account is not yet locked
    });
    expect(real.statusCode).toBe(200);

    const burst: number[] = [];
    for (let i = 0; i < 32; i++) {
      const r = await ctx.call('POST', '/api/admin/auth/login', {
        body: { username: `ghost${i}`, password: 'whatever-password-1' },
        ip: '203.0.113.9',
      });
      burst.push(r.statusCode);
    }
    expect(burst.slice(0, 30).every((c) => c === 401)).toBe(true);
    expect(burst.slice(30)).toEqual([429, 429]);
  }, 60_000);

  it('a stranger who knows the password cannot knock out the admin’s own sign-in in progress', async () => {
    const a = await seed();
    const mine = await login(a);
    await login(a); // someone else signs in with the same password: a second pending session
    const res = await ctx.call('POST', '/api/admin/auth/mfa/verify', {
      cookie: mine.cookie,
      csrf: mine.csrf,
      body: { code: nextCode(a.secret) },
    });
    expect(res.statusCode).toBe(200);
  });

  it('records a refused sign-in only when the password was right (no audit flooding)', async () => {
    const a = await seed();
    await db.update(adminUsers).set({ isDisabled: true }).where(eq(adminUsers.id, a.id));
    for (let i = 0; i < 5; i++) await login(a, `guessing-a-password-${i}`);
    expect(await audit('admin.login.refused')).toHaveLength(0);
    await login(a); // right password on a disabled account: that is worth knowing about
    expect(await audit('admin.login.refused')).toHaveLength(1);
  });

  it('upgrades an old password hash to the current cost on a good sign-in', async () => {
    const a = await seed();
    const salt = randomBytes(16);
    const tag = argon2Sync('argon2id', {
      message: Buffer.from(PASSWORD),
      nonce: salt,
      memory: 19_456,
      passes: 2,
      parallelism: 1,
      tagLength: 32,
    });
    const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '');
    const legacy = `$argon2id$v=19$m=19456,t=2,p=1$${b64(salt)}$${b64(tag)}`;
    await db.update(adminUsers).set({ passwordHash: legacy }).where(eq(adminUsers.id, a.id));
    expect((await login(a)).res.statusCode).toBe(200); // the old hash still verifies…
    const upgraded = (await adminRow(a.id)).passwordHash;
    expect(upgraded).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/); // …and was replaced at today's cost
    expect((await login(a)).res.statusCode).toBe(200);
  });
});

/* ═══════════════════ second factor ═══════════════════ */

describe('second factor', () => {
  it('rejects a wrong code, counts it, and a used code cannot be replayed', async () => {
    const a = await seed();
    const first = await login(a);
    const bad = await ctx.call('POST', '/api/admin/auth/mfa/verify', {
      cookie: first.cookie,
      csrf: first.csrf,
      body: { code: '000000' },
    });
    expect(bad.statusCode).toBe(401);
    expect((await adminRow(a.id)).failedAttempts).toBe(1);

    const code = nextCode(a.secret);
    const ok = await ctx.call('POST', '/api/admin/auth/mfa/verify', {
      cookie: first.cookie,
      csrf: first.csrf,
      body: { code },
    });
    expect(ok.statusCode).toBe(200);

    // The same code, a moment later, on a brand-new password-authenticated session: refused (replay).
    const second = await login(a);
    const replay = await ctx.call('POST', '/api/admin/auth/mfa/verify', {
      cookie: second.cookie,
      csrf: second.csrf,
      body: { code },
    });
    expect(replay.statusCode).toBe(401);
  });

  it('accepts a code one step either side of now (clock drift) but not two', async () => {
    const a = await seed();
    const first = await login(a);
    const secret = base32Decode(a.secret);
    const twoBack = hotp(secret, stepAt(clock.getTime()) - 2);
    const oneBack = hotp(secret, stepAt(clock.getTime()) - 1);
    const refuse = await ctx.call('POST', '/api/admin/auth/mfa/verify', {
      cookie: first.cookie,
      csrf: first.csrf,
      body: { code: twoBack },
    });
    expect(refuse.statusCode).toBe(401);
    const accept = await ctx.call('POST', '/api/admin/auth/mfa/verify', {
      cookie: first.cookie,
      csrf: first.csrf,
      body: { code: oneBack },
    });
    expect(accept.statusCode).toBe(200);
  });

  it('five wrong codes lock the account and end the pending session', async () => {
    const a = await seed();
    const first = await login(a);
    for (let i = 0; i < 5; i++)
      await ctx.call('POST', '/api/admin/auth/mfa/verify', {
        cookie: first.cookie,
        csrf: first.csrf,
        body: { code: String(100000 + i) },
      });
    expect((await adminRow(a.id)).lockedUntil).not.toBeNull();
    const after = await ctx.call('POST', '/api/admin/auth/mfa/verify', {
      cookie: first.cookie,
      csrf: first.csrf,
      body: { code: nextCode(a.secret) },
    });
    expect(after.statusCode).toBe(401); // even the RIGHT code: the session is gone
  });

  it('eight parallel requests with the same code: exactly one wins', async () => {
    const a = await seed();
    const sessions = await Promise.all(
      Array.from({ length: 8 }, () =>
        ctx.app.adminSessions.create(a.id, false, { ip: null, userAgent: null }),
      ),
    );
    const code = nextCode(a.secret);
    const results = await Promise.all(
      sessions.map((p) =>
        ctx.call('POST', '/api/admin/auth/mfa/verify', {
          cookie: p.token,
          csrf: p.csrfToken,
          body: { code },
          ip: '10.0.0.1',
        }),
      ),
    );
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 401)).toHaveLength(7);
  });

  it('refuses a malformed body (neither or both of code / recoveryCode)', async () => {
    const a = await seed();
    const first = await login(a);
    for (const body of [
      {},
      { code: '12345' },
      { code: '123456', recoveryCode: 'AAAA-BBBB-CCCC' },
      { code: 123456 },
    ]) {
      const r = await ctx.call('POST', '/api/admin/auth/mfa/verify', {
        cookie: first.cookie,
        csrf: first.csrf,
        body,
      });
      expect(r.statusCode).toBe(400);
    }
  });
});

/* ═══════════════════ enrolment & recovery codes ═══════════════════ */

describe('authenticator enrolment', () => {
  it('first sign-in enrols an authenticator and issues one-time recovery codes', async () => {
    const a = await seed({ mfa: false });
    const first = await login(a);
    expect(first.body.stage).toBe('enroll');

    const start = await ctx.call('POST', '/api/admin/auth/mfa/enroll/start', {
      cookie: first.cookie,
      csrf: first.csrf,
    });
    expect(start.statusCode).toBe(200);
    const { secret, otpauthUri } = start.json();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(otpauthUri).toContain(`secret=${secret}`);

    // Stored encrypted (AES-GCM envelope), never as the base32 secret; and not yet trusted.
    const pending = await adminRow(a.id);
    expect(pending.totpSecretEnc).toMatch(/^v1\./);
    expect(pending.totpSecretEnc).not.toContain(secret);
    expect(pending.mfaEnabled).toBe(false);

    const wrong = await ctx.call('POST', '/api/admin/auth/mfa/enroll/confirm', {
      cookie: first.cookie,
      csrf: first.csrf,
      body: { code: '000000' },
    });
    expect(wrong.statusCode).toBe(401);
    expect((await adminRow(a.id)).mfaEnabled).toBe(false);

    const done = await ctx.call('POST', '/api/admin/auth/mfa/enroll/confirm', {
      cookie: first.cookie,
      csrf: first.csrf,
      body: { code: nextCode(secret) },
    });
    expect(done.statusCode).toBe(200);
    const { recoveryCodes, session } = done.json();
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    for (const c of recoveryCodes)
      expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(session.stage).toBe('ready');
    expect(jar(done)).not.toBe(first.cookie);
    expect((await adminRow(a.id)).mfaEnabled).toBe(true);

    // Only keyed hashes are stored.
    const stored = await db
      .select()
      .from(adminRecoveryCodes)
      .where(eq(adminRecoveryCodes.adminId, a.id));
    expect(stored).toHaveLength(10);
    for (const c of recoveryCodes)
      for (const row of stored) expect(row.codeHash).not.toContain(c.replace(/-/g, ''));
    expect((await audit('admin.mfa.enrolled')).length).toBe(1);
  });

  it('cannot be used to overwrite an authenticator that is already enrolled', async () => {
    // Someone who has only the PASSWORD must not be able to swap in their own device.
    const a = await seed({ mfa: true });
    const first = await login(a);
    const start = await ctx.call('POST', '/api/admin/auth/mfa/enroll/start', {
      cookie: first.cookie,
      csrf: first.csrf,
    });
    expect(start.statusCode).toBe(409);
    const confirm = await ctx.call('POST', '/api/admin/auth/mfa/enroll/confirm', {
      cookie: first.cookie,
      csrf: first.csrf,
      body: { code: nextCode(a.secret) },
    });
    expect(confirm.statusCode).toBe(409);
    const row = await adminRow(a.id);
    expect(cipher.decrypt(row.totpSecretEnc!, 'admin.totp')).toBe(a.secret);
  });

  it('an enrolment that is never confirmed grants nothing', async () => {
    const a = await seed({ mfa: false });
    const first = await login(a);
    await ctx.call('POST', '/api/admin/auth/mfa/enroll/start', {
      cookie: first.cookie,
      csrf: first.csrf,
    });
    const probe = await ctx.call('GET', '/api/admin/users', { cookie: first.cookie });
    expect(probe.statusCode).toBe(403);
    expect(probe.json().error.code).toBe('MFA_REQUIRED');
  });
});

describe('recovery codes', () => {
  async function withCodes() {
    const a = await seed({ mfa: false });
    const first = await login(a);
    const { secret } = (
      await ctx.call('POST', '/api/admin/auth/mfa/enroll/start', {
        cookie: first.cookie,
        csrf: first.csrf,
      })
    ).json();
    const done = await ctx.call('POST', '/api/admin/auth/mfa/enroll/confirm', {
      cookie: first.cookie,
      csrf: first.csrf,
      body: { code: nextCode(secret) },
    });
    return {
      a: { ...a, secret },
      codes: done.json().recoveryCodes as string[],
      session: { cookie: jar(done)!, csrf: done.json().session.csrfToken as string },
    };
  }

  it('a recovery code signs in once (forgiving about case and dashes) and then is spent', async () => {
    const { a, codes } = await withCodes();
    const typed = codes[0]!.toLowerCase().replace(/-/g, ' ');
    const first = await login(a);
    const ok = await ctx.call('POST', '/api/admin/auth/mfa/verify', {
      cookie: first.cookie,
      csrf: first.csrf,
      body: { recoveryCode: typed },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().recoveryCodesRemaining).toBe(9);

    const second = await login(a);
    const again = await ctx.call('POST', '/api/admin/auth/mfa/verify', {
      cookie: second.cookie,
      csrf: second.csrf,
      body: { recoveryCode: codes[0] },
    });
    expect(again.statusCode).toBe(401);
    const other = await ctx.call('POST', '/api/admin/auth/mfa/verify', {
      cookie: second.cookie,
      csrf: second.csrf,
      body: { recoveryCode: codes[1] },
    });
    expect(other.statusCode).toBe(200);
    expect(other.json().recoveryCodesRemaining).toBe(8);
  });

  it('eight parallel uses of one recovery code: exactly one wins', async () => {
    const { a, codes } = await withCodes();
    const sessions = await Promise.all(
      Array.from({ length: 8 }, () =>
        ctx.app.adminSessions.create(a.id, false, { ip: null, userAgent: null }),
      ),
    );
    const results = await Promise.all(
      sessions.map((p) =>
        ctx.call('POST', '/api/admin/auth/mfa/verify', {
          cookie: p.token,
          csrf: p.csrfToken,
          body: { recoveryCode: codes[2] },
        }),
      ),
    );
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
  });

  it('regenerating needs a fresh authenticator code and voids every old code', async () => {
    const { a, codes, session } = await withCodes();
    const noCode = await ctx.call('POST', '/api/admin/auth/recovery-codes', {
      cookie: session.cookie,
      csrf: session.csrf,
      body: { code: '000000' },
    });
    expect(noCode.statusCode).toBe(401);
    const ok = await ctx.call('POST', '/api/admin/auth/recovery-codes', {
      cookie: session.cookie,
      csrf: session.csrf,
      body: { code: nextCode(a.secret) },
    });
    expect(ok.statusCode).toBe(200);
    const fresh = ok.json().recoveryCodes as string[];
    expect(fresh).toHaveLength(10);
    expect(fresh.some((c) => codes.includes(c))).toBe(false);
    const live = await db
      .select()
      .from(adminRecoveryCodes)
      .where(and(eq(adminRecoveryCodes.adminId, a.id), isNull(adminRecoveryCodes.usedAt)));
    expect(live).toHaveLength(10);
    const first = await login(a);
    const old = await ctx.call('POST', '/api/admin/auth/mfa/verify', {
      cookie: first.cookie,
      csrf: first.csrf,
      body: { recoveryCode: codes[0] },
    });
    expect(old.statusCode).toBe(401);
  });
});

describe('credentials are spent only if the sign-in completes', () => {
  it('a failure while issuing the session gives the recovery code (and the time-step) back', async () => {
    const a = await seed({ mfa: false });
    const first = await login(a);
    const { secret } = (
      await ctx.call('POST', '/api/admin/auth/mfa/enroll/start', {
        cookie: first.cookie,
        csrf: first.csrf,
      })
    ).json();
    const done = await ctx.call('POST', '/api/admin/auth/mfa/enroll/confirm', {
      cookie: first.cookie,
      csrf: first.csrf,
      body: { code: nextCode(secret) },
    });
    const codes = done.json().recoveryCodes as string[];
    const before = await adminRow(a.id);

    const pending = await login({ ...a, secret });
    const realCreate = ctx.app.adminSessions.create.bind(ctx.app.adminSessions);
    ctx.app.adminSessions.create = async () => {
      throw new Error('database hiccup');
    };
    const broken = await ctx.call('POST', '/api/admin/auth/mfa/verify', {
      cookie: pending.cookie,
      csrf: pending.csrf,
      body: { recoveryCode: codes[0] },
    });
    expect(broken.statusCode).toBe(500);
    ctx.app.adminSessions.create = realCreate;

    // Nothing was spent: the same code works on the retry, and the failure was not counted as a wrong guess.
    const unused = await db
      .select()
      .from(adminRecoveryCodes)
      .where(and(eq(adminRecoveryCodes.adminId, a.id), isNull(adminRecoveryCodes.usedAt)));
    expect(unused).toHaveLength(10);
    expect((await adminRow(a.id)).totpLastStep).toBe(before.totpLastStep);
    expect((await adminRow(a.id)).failedAttempts).toBe(0);
    const retry = await ctx.call('POST', '/api/admin/auth/mfa/verify', {
      cookie: pending.cookie,
      csrf: pending.csrf,
      body: { recoveryCode: codes[0] },
    });
    expect(retry.statusCode).toBe(200);
  });

  it('recovery codes survive a change of SESSION_SECRET (they are not keyed with the cookie secret)', async () => {
    const a = await seed({ mfa: false });
    const first = await login(a);
    const { secret } = (
      await ctx.call('POST', '/api/admin/auth/mfa/enroll/start', {
        cookie: first.cookie,
        csrf: first.csrf,
      })
    ).json();
    const done = await ctx.call('POST', '/api/admin/auth/mfa/enroll/confirm', {
      cookie: first.cookie,
      csrf: first.csrf,
      body: { code: nextCode(secret) },
    });
    const codes = done.json().recoveryCodes as string[];
    const rotated = await makeApp({
      SESSION_SECRET: 'rotated-after-a-scare-'.padEnd(40, 'x'),
      PII_ENCRYPTION_KEY: env.PII_ENCRYPTION_KEY,
      PHONE_HASH_PEPPER: env.PHONE_HASH_PEPPER,
    });
    ctx = rotated;
    const again = await login({ ...a, secret });
    const ok = await ctx.call('POST', '/api/admin/auth/mfa/verify', {
      cookie: again.cookie,
      csrf: again.csrf,
      body: { recoveryCode: codes[3] },
    });
    expect(ok.statusCode).toBe(200);
  });
});

describe('sensitive prompts while the account is locked', () => {
  it('a signed-in session gets only a handful of guesses at the current password, and is not thrown out', async () => {
    const a = await seed();
    const s = await signIn(a);
    const outcomes: number[] = [];
    for (let i = 0; i < 8; i++) {
      const r = await ctx.call('POST', '/api/admin/auth/password', {
        cookie: s.cookie,
        csrf: s.csrf,
        body: {
          currentPassword: `stolen-session-guess-${i}-x`,
          newPassword: 'another-long-passphrase-2',
        },
      });
      outcomes.push(r.statusCode);
    }
    // Five real guesses (400), then the lock answers 429 for the rest, without ever checking the password again.
    expect(outcomes).toEqual([400, 400, 400, 400, 400, 429, 429, 429]);
    expect((await adminRow(a.id)).failedAttempts).toBe(5);
    const still = await ctx.call('GET', '/api/admin/auth/session', { cookie: s.cookie });
    expect(still.json().authenticated).toBe(true);
    // The right password is refused too while locked, and works once the lock has expired.
    const right = await ctx.call('POST', '/api/admin/auth/password', {
      cookie: s.cookie,
      csrf: s.csrf,
      body: { currentPassword: PASSWORD, newPassword: 'another-long-passphrase-2' },
    });
    expect(right.statusCode).toBe(429);
    expect(right.json().error.details.retryAfterSeconds).toBeGreaterThan(0);
    advance(5 * 60_000 + 1000);
    const later = await ctx.call('POST', '/api/admin/auth/password', {
      cookie: s.cookie,
      csrf: s.csrf,
      body: { currentPassword: PASSWORD, newPassword: 'another-long-passphrase-2' },
    });
    expect(later.statusCode).toBe(200);
  });

  it('the same for recovery-code regeneration', async () => {
    const a = await seed();
    const s = await signIn(a);
    const outcomes: number[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await ctx.call('POST', '/api/admin/auth/recovery-codes', {
        cookie: s.cookie,
        csrf: s.csrf,
        body: { code: '000000' },
      });
      outcomes.push(r.statusCode);
    }
    expect(outcomes).toEqual([401, 401, 401, 401, 401, 429, 429]);
    // Even a correct code is refused while locked.
    const good = await ctx.call('POST', '/api/admin/auth/recovery-codes', {
      cookie: s.cookie,
      csrf: s.csrf,
      body: { code: nextCode(a.secret) },
    });
    expect(good.statusCode).toBe(429);
  });
});

/* ═══════════════════ sessions ═══════════════════ */

describe('session lifetime', () => {
  it('a pending (password-only) session dies after 10 minutes', async () => {
    const a = await seed();
    const first = await login(a);
    advance(PENDING_MS + 1000);
    const r = await ctx.call('POST', '/api/admin/auth/mfa/verify', {
      cookie: first.cookie,
      csrf: first.csrf,
      body: { code: nextCode(a.secret) },
    });
    expect(r.statusCode).toBe(401);
  });

  it('a full session ends after 30 idle minutes, and activity keeps it alive', async () => {
    const a = await seed();
    const s = await signIn(a);
    for (let i = 0; i < 3; i++) {
      advance(IDLE_MS - 5 * 60_000);
      expect((await ctx.call('GET', '/api/admin/users', { cookie: s.cookie })).statusCode).toBe(
        200,
      );
    }
    advance(IDLE_MS + 1000);
    const gone = await ctx.call('GET', '/api/admin/users', { cookie: s.cookie });
    expect(gone.statusCode).toBe(401);
    expect(await db.select().from(adminSessions)).toHaveLength(0); // and the row is removed, not just ignored
  });

  it('a full session ends after 8 hours however active it is', async () => {
    const a = await seed();
    const s = await signIn(a);
    // Busy the whole time: a request every 20 minutes for 7h40m.
    for (let i = 0; i < 23; i++) {
      advance(20 * 60_000);
      expect((await ctx.call('GET', '/api/admin/users', { cookie: s.cookie })).statusCode).toBe(
        200,
      );
    }
    advance(25 * 60_000); // 8h05m after sign-in: busy, but past the absolute limit
    expect((await ctx.call('GET', '/api/admin/users', { cookie: s.cookie })).statusCode).toBe(401);
  });

  it('logout ends the session on the server, not just in the browser', async () => {
    const a = await seed();
    const s = await signIn(a);
    const out = await ctx.call('POST', '/api/admin/auth/logout', {
      cookie: s.cookie,
      csrf: s.csrf,
    });
    expect(out.statusCode).toBe(200);
    expect(out.cookies.find((c) => c.name === COOKIE)?.value).toBe('');
    expect((await ctx.call('GET', '/api/admin/users', { cookie: s.cookie })).statusCode).toBe(401);
    expect(await db.select().from(adminSessions)).toHaveLength(0);
  });

  it('disabling an admin ends their session on the very next request', async () => {
    const boss = await seed({ username: 'boss' });
    const other = await seed({ username: 'other', role: 'ADMIN' });
    const s = await signIn(other);
    expect(
      (await ctx.call('GET', '/api/admin/auth/session', { cookie: s.cookie })).json().authenticated,
    ).toBe(true);
    await ctx.app.adminUsers.update(
      other.id,
      { isDisabled: true },
      { adminId: boss.id, label: 'admin:boss' },
    );
    expect(
      (await ctx.call('GET', '/api/admin/auth/session', { cookie: s.cookie })).json().authenticated,
    ).toBe(false);
  });

  it('a disabled flag set straight in the database (psql, a migration) also ends the session', async () => {
    // Revoking sessions on disable is one layer; this proves the per-request check is a second, independent one.
    const a = await seed({ role: 'ADMIN' });
    const s = await signIn(a);
    await db.update(adminUsers).set({ isDisabled: true }).where(eq(adminUsers.id, a.id));
    expect((await ctx.call('GET', '/api/admin/auth/session', { cookie: s.cookie })).json()).toEqual(
      {
        authenticated: false,
      },
    );
  });

  it('a temporary password that expires mid-session ends that session too', async () => {
    const a = await seed({
      mustChange: true,
      credentialsExpireAt: new Date(T0.getTime() + 60 * 60_000),
    });
    const s = await signIn(a);
    expect(
      (await ctx.call('GET', '/api/admin/auth/session', { cookie: s.cookie })).json().authenticated,
    ).toBe(true);
    for (let i = 0; i < 4; i++) {
      advance(20 * 60_000);
      await ctx.call('GET', '/api/admin/auth/session', { cookie: s.cookie });
    }
    expect(
      (await ctx.call('GET', '/api/admin/auth/session', { cookie: s.cookie })).json().authenticated,
    ).toBe(false);
  });

  it('ignores a malformed or forged cookie without touching the database', async () => {
    for (const junk of ['', 'abc', 'mca_short', `mca_${'A'.repeat(43)}`, "mca_' OR 1=1 --"]) {
      const r = await ctx.call('GET', '/api/admin/users', { cookie: junk || 'x' });
      expect(r.statusCode).toBe(401);
    }
  });

  it('uses __Host- prefixed, Secure cookies over HTTPS', async () => {
    const secure = await makeApp({ PUBLIC_ORIGIN: 'https://vote.example.org' });
    const a = await seed();
    const res = await secure.call('POST', '/api/admin/auth/login', {
      body: { username: a.username, password: a.password },
    });
    const c = res.cookies.find((x) => x.name === '__Host-mc_admin')!;
    expect(c).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/' });
    expect(c).not.toHaveProperty('domain');
  });
});

/* ═══════════════════ CSRF ═══════════════════ */

describe('CSRF', () => {
  it('refuses every state-changing request without the per-session token', async () => {
    const a = await seed();
    const s = await signIn(a);
    const url = '/api/admin/users';
    const body = { username: 'newbie', role: 'ADMIN' };
    const none = await ctx.call('POST', url, { cookie: s.cookie, body });
    expect(none.statusCode).toBe(403);
    expect(none.json().error.code).toBe('CSRF_FAILED');
    const wrong = await ctx.call('POST', url, { cookie: s.cookie, csrf: 'x'.repeat(43), body });
    expect(wrong.json().error.code).toBe('CSRF_FAILED');
    // Another session's token is not valid here.
    const b = await seed();
    const other = await signIn(b);
    const swapped = await ctx.call('POST', url, { cookie: s.cookie, csrf: other.csrf, body });
    expect(swapped.json().error.code).toBe('CSRF_FAILED');
    const ok = await ctx.call('POST', url, { cookie: s.cookie, csrf: s.csrf, body });
    expect(ok.statusCode).toBe(200);
    expect(
      (
        await adminRow(
          (await db.select().from(adminUsers).where(eq(adminUsers.username, 'newbie')))[0]!.id,
        )
      ).username,
    ).toBe('newbie');
  });

  it('refuses a cross-origin browser request even with a valid cookie and token', async () => {
    const a = await seed();
    const s = await signIn(a);
    const evil = await ctx.call('POST', '/api/admin/users', {
      cookie: s.cookie,
      csrf: s.csrf,
      body: { username: 'evil', role: 'SUPER_ADMIN' },
      headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    });
    expect(evil.statusCode).toBe(403);
    expect((await db.select().from(adminUsers).where(eq(adminUsers.username, 'evil'))).length).toBe(
      0,
    );
  });

  it('reads never need the token', async () => {
    const a = await seed();
    const s = await signIn(a);
    expect((await ctx.call('GET', '/api/admin/users', { cookie: s.cookie })).statusCode).toBe(200);
  });
});

/* ═══════════════════ operator-issued passwords ═══════════════════ */

describe('temporary passwords', () => {
  async function issued(role: AdminRole = 'ADMIN') {
    const out = await ctx.app.adminUsers.create({ username: 'newbie', role }, cli);
    return {
      out,
      a: {
        id: out.user.id,
        username: 'newbie',
        password: out.temporaryPassword,
        secret: '',
      } as Seeded,
    };
  }

  it('walks password → authenticator → new password, and only then reaches the console', async () => {
    const { out, a } = await issued();
    expect(out.temporaryPassword).toMatch(/^[a-km-zA-HJ-NP-Z2-9]{20}$/);
    const row = await adminRow(a.id);
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row.passwordHash).not.toContain(out.temporaryPassword);
    expect(row.mustChangePassword).toBe(true);

    const first = await login(a);
    expect(first.body.stage).toBe('enroll');
    const { secret } = (
      await ctx.call('POST', '/api/admin/auth/mfa/enroll/start', {
        cookie: first.cookie,
        csrf: first.csrf,
      })
    ).json();
    const enrolled = await ctx.call('POST', '/api/admin/auth/mfa/enroll/confirm', {
      cookie: first.cookie,
      csrf: first.csrf,
      body: { code: nextCode(secret) },
    });
    expect(enrolled.json().session.stage).toBe('password');
    const cookie = jar(enrolled)!;
    const csrf = enrolled.json().session.csrfToken as string;

    // MFA is done but the temporary password is still owed: nothing but the password change works.
    const blocked = await ctx.call('GET', '/api/admin/auth/session', { cookie });
    expect(blocked.json().stage).toBe('password');
    const probe = await ctx.call('GET', '/api/admin/audit', { cookie });
    expect(probe.statusCode).toBe(403);
    expect(probe.json().error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const weak = await ctx.call('POST', '/api/admin/auth/password', {
      cookie,
      csrf,
      body: { currentPassword: out.temporaryPassword, newPassword: 'short' },
    });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().error.details.problem).toBe('too_short');
    const wrongCurrent = await ctx.call('POST', '/api/admin/auth/password', {
      cookie,
      csrf,
      body: { currentPassword: 'not-the-current-one', newPassword: 'a-brand-new-passphrase' },
    });
    expect(wrongCurrent.json().error.details.problem).toBe('current_incorrect');
    const same = await ctx.call('POST', '/api/admin/auth/password', {
      cookie,
      csrf,
      body: { currentPassword: out.temporaryPassword, newPassword: out.temporaryPassword },
    });
    expect(same.json().error.details.problem).toBe('same_as_current');

    const changed = await ctx.call('POST', '/api/admin/auth/password', {
      cookie,
      csrf,
      body: { currentPassword: out.temporaryPassword, newPassword: 'a-brand-new-passphrase' },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().stage).toBe('ready');
    // The session that did the change is replaced, and the old token is dead.
    expect(jar(changed)).not.toBe(cookie);
    expect(
      (await ctx.call('GET', '/api/admin/auth/session', { cookie })).json().authenticated,
    ).toBe(false);
    const after = await adminRow(a.id);
    expect(after.mustChangePassword).toBe(false);
    expect(after.credentialsExpireAt).toBeNull();
    expect((await login({ ...a, password: out.temporaryPassword })).res.statusCode).toBe(401);
  });

  it('an unused temporary password expires after 48 hours', async () => {
    const { a } = await issued();
    advance(47 * 3_600_000);
    expect((await login(a)).res.statusCode).toBe(200);
    advance(2 * 3_600_000);
    expect((await login(a)).res.statusCode).toBe(401);
    expect((await audit('admin.login.refused')).length).toBe(1);
  });

  it('changing the password ends every OTHER session of that admin', async () => {
    const a = await seed();
    const s1 = await signIn(a);
    const s2 = await signIn(a);
    const r = await ctx.call('POST', '/api/admin/auth/password', {
      cookie: s1.cookie,
      csrf: s1.csrf,
      body: { currentPassword: PASSWORD, newPassword: 'another-long-passphrase-2' },
    });
    expect(r.statusCode).toBe(200);
    expect(
      (await ctx.call('GET', '/api/admin/auth/session', { cookie: s2.cookie })).json()
        .authenticated,
    ).toBe(false);
    expect(
      (await ctx.call('GET', '/api/admin/auth/session', { cookie: jar(r)! })).json().authenticated,
    ).toBe(true);
  });

  it('a wrong current password counts toward the lock-out', async () => {
    const a = await seed();
    const s = await signIn(a);
    for (let i = 0; i < 5; i++)
      await ctx.call('POST', '/api/admin/auth/password', {
        cookie: s.cookie,
        csrf: s.csrf,
        body: {
          currentPassword: `guess-${i}-guess-guess`,
          newPassword: 'another-long-passphrase-2',
        },
      });
    expect((await adminRow(a.id)).lockedUntil).not.toBeNull();
  });
});

/* ═══════════════════ authorisation ═══════════════════ */

describe('authorisation (RBAC)', () => {
  type Principal = 'anon' | 'pending' | 'mustChange' | 'ADMIN' | 'SUPER_ADMIN';
  const PRINCIPALS: Principal[] = ['anon', 'pending', 'mustChange', 'ADMIN', 'SUPER_ADMIN'];
  const AUTH_FAILURES = [
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'MFA_REQUIRED',
    'PASSWORD_CHANGE_REQUIRED',
    'CSRF_FAILED',
  ];

  /** The matrix, written out independently of the guard: what each kind of caller must get from each access level. */
  function expected(
    access: Access,
    p: Principal,
  ): { allowed: true } | { allowed: false; status: number; code: string } {
    if (access === 'public') return { allowed: true };
    if (p === 'anon') return { allowed: false, status: 401, code: 'UNAUTHENTICATED' };
    if (access === 'pending') return { allowed: true };
    if (p === 'pending') return { allowed: false, status: 403, code: 'MFA_REQUIRED' };
    if (access === 'mfa') return { allowed: true };
    if (p === 'mustChange')
      return { allowed: false, status: 403, code: 'PASSWORD_CHANGE_REQUIRED' };
    return can(p, access) ? { allowed: true } : { allowed: false, status: 403, code: 'FORBIDDEN' };
  }

  async function principal(p: Principal): Promise<{ cookie?: string; csrf?: string }> {
    if (p === 'anon') return {};
    const role: AdminRole = p === 'ADMIN' ? 'ADMIN' : 'SUPER_ADMIN';
    const a = await seed({ role, mustChange: p === 'mustChange' });
    // Sessions are issued directly (this test is about the guard, not the sign-in dance).
    const s = await ctx.app.adminSessions.create(a.id, p !== 'pending', {
      ip: null,
      userAgent: null,
    });
    return { cookie: s.token, csrf: s.csrfToken };
  }

  it('every real /api/admin route enforces its declared access for every kind of caller', async () => {
    const table = ctx.app.adminRouteTable.filter(
      (r) => r.method !== 'HEAD' && r.method !== 'OPTIONS',
    );
    expect(table.length).toBeGreaterThanOrEqual(15);
    // Every route declares something, and that something is a known level.
    const known = new Set<string>(['public', 'pending', 'mfa', ...Object.keys(PERMISSIONS)]);
    for (const r of table) expect(known.has(r.access), `${r.method} ${r.url}`).toBe(true);

    const id = '00000000-0000-4000-8000-000000000000';
    for (const route of table) {
      const url = route.url.replace(':id', id);
      for (const p of PRINCIPALS) {
        const who = await principal(p);
        const res = await ctx.call(
          route.method as 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
          url,
          {
            ...who,
            body: route.method === 'GET' ? undefined : {},
          },
        );
        const want = expected(route.access, p);
        const label = `${route.method} ${route.url} as ${p}`;
        if (want.allowed) {
          // Allowed callers may still get 400/404/409 for an empty probe, but never an authentication or authorisation failure.
          const code = res.statusCode >= 400 ? (res.json().error.code as string) : 'ok';
          expect(AUTH_FAILURES, label).not.toContain(code);
        } else {
          expect(res.statusCode, label).toBe(want.status);
          expect(res.json().error.code, label).toBe(want.code);
        }
      }
    }
  }, 120_000);

  it('a session still waiting for MFA reaches nothing except the MFA routes and logout', async () => {
    const a = await seed();
    const open: Array<[string, string]> = [];
    for (const r of ctx.app.adminRouteTable.filter(
      (r) => r.method !== 'HEAD' && r.method !== 'OPTIONS',
    )) {
      // A fresh password-only session per route (logout, for one, would otherwise end the sweep).
      const pending = await ctx.app.adminSessions.create(a.id, false, {
        ip: null,
        userAgent: null,
      });
      const res = await ctx.call(
        r.method as 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
        r.url.replace(':id', a.id),
        {
          cookie: pending.token,
          csrf: pending.csrfToken,
          body: r.method === 'GET' ? undefined : {},
        },
      );
      const blocked = res.statusCode === 403 && res.json().error.code === 'MFA_REQUIRED';
      if (!blocked && r.access !== 'public' && r.access !== 'pending') open.push([r.method, r.url]);
    }
    expect(open).toEqual([]);
  });

  it('role matrix: ADMIN is refused SUPER_ADMIN-only routes and the refusal is audited', async () => {
    const lower = await seed({ role: 'ADMIN' });
    const s = await signIn(lower);
    for (const [method, url] of [
      ['GET', '/api/admin/users'],
      ['GET', '/api/admin/audit'],
    ] as const) {
      const r = await ctx.call(method, url, { cookie: s.cookie });
      expect(r.statusCode).toBe(403);
      expect(r.json().error.code).toBe('FORBIDDEN');
    }
    const create = await ctx.call('POST', '/api/admin/users', {
      cookie: s.cookie,
      csrf: s.csrf,
      body: { username: 'sneaky', role: 'SUPER_ADMIN' },
    });
    expect(create.statusCode).toBe(403);
    expect(
      await db.select().from(adminUsers).where(eq(adminUsers.username, 'sneaky')),
    ).toHaveLength(0);
    const denied = await audit('admin.access.denied');
    expect(denied.length).toBe(3);
    expect(denied[0]!.actorAdminId).toBe(lower.id);
  });

  it('a role change takes effect on the very next request, without signing in again', async () => {
    const boss = await seed({ username: 'boss' });
    const promoted = await seed({ username: 'promoted', role: 'ADMIN' });
    const s = await signIn(promoted);
    expect((await ctx.call('GET', '/api/admin/users', { cookie: s.cookie })).statusCode).toBe(403);
    await ctx.app.adminUsers.update(
      promoted.id,
      { role: 'SUPER_ADMIN' },
      { adminId: boss.id, label: 'admin:boss' },
    );
    expect((await ctx.call('GET', '/api/admin/users', { cookie: s.cookie })).statusCode).toBe(200);
    await ctx.app.adminUsers.update(
      promoted.id,
      { role: 'ADMIN' },
      { adminId: boss.id, label: 'admin:boss' },
    );
    expect((await ctx.call('GET', '/api/admin/users', { cookie: s.cookie })).statusCode).toBe(403);
  });

  it('a display token is not an admin credential', async () => {
    const { token } = await ctx.app.displays.create('Main hall', cli);
    const r = await ctx.call('GET', '/api/admin/users', {
      headers: { cookie: `mc_display=${token}; mc_admin=${token}` },
    });
    expect(r.statusCode).toBe(401);
  });
});

/* The guard's own contract, on a bare server: this is what protects every route Phase 6 will add. */
describe('the guard, in isolation', () => {
  async function bare(routes: (app: ReturnType<typeof Fastify>) => void) {
    const app = Fastify().withTypeProvider<ZodTypeProvider>();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('deps', { env, db } as never);
    app.decorate('adminSessions', new AdminSessions(db, () => clock));
    app.decorate('adminRouteTable', []);
    await app.register(errorsPlugin);
    await app.register(cookie);
    await app.register(async (scope) => {
      await scope.register(adminGuard);
      routes(scope as never);
    });
    return app;
  }

  it('refuses to boot when a route forgets to declare its access', async () => {
    await expect(
      bare((app) => {
        app.get('/forgotten', async () => ({ ok: true }));
      }),
    ).rejects.toThrow(/must declare config\.access/);
  });

  it('grants exactly what the permission table says, for every permission and role', async () => {
    const app = await bare((scope) => {
      for (const permission of Object.keys(PERMISSIONS) as Array<keyof typeof PERMISSIONS>)
        scope.get(`/p/${permission}`, { config: { access: permission } }, async () => ({
          ok: true,
        }));
    });
    for (const role of ['SUPER_ADMIN', 'ADMIN'] as const) {
      const a = await seed({ role });
      const s = await new AdminSessions(db, () => clock).create(a.id, true, {
        ip: null,
        userAgent: null,
      });
      for (const permission of Object.keys(PERMISSIONS) as Array<keyof typeof PERMISSIONS>) {
        const res = await app.inject({
          method: 'GET',
          url: `/p/${permission}`,
          cookies: { mc_admin: s.token },
        });
        expect(res.statusCode, `${role} ${permission}`).toBe(can(role, permission) ? 200 : 403);
      }
    }
    await app.close();
  });

  it('the table is deny-by-default: there is no permission nobody holds, and ADMIN never outranks SUPER_ADMIN', () => {
    for (const [permission, roles] of Object.entries(PERMISSIONS)) {
      expect(roles.length, permission).toBeGreaterThan(0);
      if ((roles as readonly string[]).includes('ADMIN'))
        expect(roles as readonly string[]).toContain('SUPER_ADMIN');
    }
  });
});

/* ═══════════════════ admin accounts ═══════════════════ */

describe('admin account management', () => {
  async function boss() {
    const a = await seed({ username: 'boss' });
    return { a, s: await signIn(a) };
  }

  it('SUPER_ADMIN creates an admin: the temporary password is returned once and never listed', async () => {
    const { s } = await boss();
    const res = await ctx.call('POST', '/api/admin/users', {
      cookie: s.cookie,
      csrf: s.csrf,
      body: { username: 'Sara.M', role: 'ADMIN' },
    });
    expect(res.statusCode).toBe(200);
    const out = res.json();
    expect(out.user).toMatchObject({
      username: 'sara.m',
      role: 'ADMIN',
      mfaEnabled: false,
      mustChangePassword: true,
    });
    expect(out.temporaryPassword).toHaveLength(20);
    expect(Date.parse(out.expiresAt) - clock.getTime()).toBe(48 * 3_600_000);

    const list = await ctx.call('GET', '/api/admin/users', { cookie: s.cookie });
    expect(list.statusCode).toBe(200);
    const text = list.body;
    expect(text).not.toContain(out.temporaryPassword);
    expect(text).not.toMatch(/passwordHash|totpSecret|argon2/);
    expect(Object.keys(list.json().users[0]).sort()).toEqual([
      'createdAt',
      'id',
      'isDisabled',
      'lastLoginAt',
      'lockedUntil',
      'mfaEnabled',
      'mustChangePassword',
      'role',
      'username',
    ]);

    const dup = await ctx.call('POST', '/api/admin/users', {
      cookie: s.cookie,
      csrf: s.csrf,
      body: { username: 'sara.m' },
    });
    expect(dup.statusCode).toBe(409);
    for (const bad of ['ab', 'has space', 'UPPER$', 'x'.repeat(33)]) {
      const r = await ctx.call('POST', '/api/admin/users', {
        cookie: s.cookie,
        csrf: s.csrf,
        body: { username: bad },
      });
      expect(r.statusCode, bad).toBe(400);
    }
    const created = await audit('admin.create');
    expect(created).toHaveLength(1);
    expect(JSON.stringify(created[0]!.details)).not.toContain(out.temporaryPassword);
  });

  it('nobody can disable or re-role themselves, and the last SUPER_ADMIN can never be removed', async () => {
    const { a, s } = await boss();
    const self = await ctx.call('PATCH', `/api/admin/users/${a.id}`, {
      cookie: s.cookie,
      csrf: s.csrf,
      body: { isDisabled: true },
    });
    expect(self.statusCode).toBe(409);
    const selfRole = await ctx.call('PATCH', `/api/admin/users/${a.id}`, {
      cookie: s.cookie,
      csrf: s.csrf,
      body: { role: 'ADMIN' },
    });
    expect(selfRole.statusCode).toBe(409);
    // The operator path has no "self", so the invariant itself must hold.
    await expect(ctx.app.adminUsers.update(a.id, { isDisabled: true }, cli)).rejects.toMatchObject({
      statusCode: 409,
    });
    await expect(ctx.app.adminUsers.update(a.id, { role: 'ADMIN' }, cli)).rejects.toMatchObject({
      statusCode: 409,
    });
    expect((await adminRow(a.id)).role).toBe('SUPER_ADMIN');
    // With a second SUPER_ADMIN the first may be demoted by the second.
    const second = await seed({ username: 'second' });
    await ctx.app.adminUsers.update(
      a.id,
      { role: 'ADMIN' },
      { adminId: second.id, label: 'admin:second' },
    );
    expect((await adminRow(a.id)).role).toBe('ADMIN');
  });

  it('two SUPER_ADMINs demoting each other at once cannot leave the system with none', async () => {
    const x = await seed({ username: 'xxx' });
    const y = await seed({ username: 'yyy' });
    const results = await Promise.allSettled([
      ctx.app.adminUsers.update(y.id, { role: 'ADMIN' }, { adminId: x.id, label: 'admin:xxx' }),
      ctx.app.adminUsers.update(x.id, { role: 'ADMIN' }, { adminId: y.id, label: 'admin:yyy' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const supers = await db.select().from(adminUsers).where(eq(adminUsers.role, 'SUPER_ADMIN'));
    expect(supers).toHaveLength(1);
  });

  it('crossing concurrent changes finish cleanly: success or a 409, never a deadlock error', async () => {
    const boss = await seed({ username: 'boss1' });
    const xs = await Promise.all(
      ['aaa1', 'bbb1', 'ccc1', 'ddd1'].map((u) => seed({ username: u })),
    );
    const actor = (id: string, label: string) => ({ adminId: id, label });
    for (let round = 0; round < 6; round++) {
      const results = await Promise.allSettled([
        ctx.app.adminUsers.update(xs[0]!.id, { role: 'ADMIN' }, actor(xs[1]!.id, 'x1')),
        ctx.app.adminUsers.update(xs[1]!.id, { role: 'ADMIN' }, actor(xs[2]!.id, 'x2')),
        ctx.app.adminUsers.update(xs[2]!.id, { role: 'ADMIN' }, actor(xs[3]!.id, 'x3')),
        ctx.app.adminUsers.update(xs[3]!.id, { role: 'ADMIN' }, actor(xs[0]!.id, 'x0')),
        ctx.app.adminUsers.update(boss.id, { role: 'ADMIN' }, actor(xs[0]!.id, 'x0')),
      ]);
      for (const r of results)
        if (r.status === 'rejected')
          expect((r.reason as { statusCode?: number }).statusCode).toBe(409);
      expect(
        (await db.select().from(adminUsers).where(eq(adminUsers.role, 'SUPER_ADMIN'))).length,
      ).toBeGreaterThan(0);
      await db.update(adminUsers).set({ role: 'SUPER_ADMIN' });
    }
  }, 60_000);

  it('reset-credentials voids password, authenticator, recovery codes and sessions in one step', async () => {
    const { s } = await boss();
    const victim = await seed({ username: 'victim', role: 'ADMIN' });
    const vs = await signIn(victim);
    await db.insert(adminRecoveryCodes).values({ adminId: victim.id, codeHash: 'h1' });

    const r = await ctx.call('POST', `/api/admin/users/${victim.id}/reset-credentials`, {
      cookie: s.cookie,
      csrf: s.csrf,
    });
    expect(r.statusCode).toBe(200);
    const row = await adminRow(victim.id);
    expect(row).toMatchObject({ mfaEnabled: false, totpSecretEnc: null, mustChangePassword: true });
    expect(
      await db.select().from(adminRecoveryCodes).where(eq(adminRecoveryCodes.adminId, victim.id)),
    ).toHaveLength(0);
    expect(
      (await ctx.call('GET', '/api/admin/auth/session', { cookie: vs.cookie })).json()
        .authenticated,
    ).toBe(false);
    // Old password is dead; the new temporary one starts the enrolment flow again.
    expect((await login(victim)).res.statusCode).toBe(401);
    const fresh = await login({ ...victim, password: r.json().temporaryPassword });
    expect(fresh.body.stage).toBe('enroll');
  });

  it('cannot reset your own credentials through the console', async () => {
    const { a, s } = await boss();
    const r = await ctx.call('POST', `/api/admin/users/${a.id}/reset-credentials`, {
      cookie: s.cookie,
      csrf: s.csrf,
    });
    expect(r.statusCode).toBe(409);
  });

  it('unlock clears a lock-out, sign-out ends sessions, disable ends them and blocks sign-in', async () => {
    const { s } = await boss();
    const t = await seed({ username: 'target', role: 'ADMIN' });
    for (let i = 0; i < 5; i++) await login(t, `wrong-password-${i}-zz`);
    expect((await login(t)).res.statusCode).toBe(401);
    const un = await ctx.call('POST', `/api/admin/users/${t.id}/unlock`, {
      cookie: s.cookie,
      csrf: s.csrf,
    });
    expect(un.statusCode).toBe(200);
    expect(un.json().lockedUntil).toBeNull();

    const ts = await signIn(t);
    const out = await ctx.call('POST', `/api/admin/users/${t.id}/sign-out`, {
      cookie: s.cookie,
      csrf: s.csrf,
    });
    expect(out.json().ended).toBeGreaterThanOrEqual(1);
    expect(
      (await ctx.call('GET', '/api/admin/auth/session', { cookie: ts.cookie })).json()
        .authenticated,
    ).toBe(false);

    const dis = await ctx.call('PATCH', `/api/admin/users/${t.id}`, {
      cookie: s.cookie,
      csrf: s.csrf,
      body: { isDisabled: true },
    });
    expect(dis.json().isDisabled).toBe(true);
    expect((await login(t)).res.statusCode).toBe(401);
    expect(
      await ctx
        .call('PATCH', `/api/admin/users/${t.id}`, { cookie: s.cookie, csrf: s.csrf, body: {} })
        .then((r) => r.statusCode),
    ).toBe(400);
    expect(
      await ctx
        .call('POST', `/api/admin/users/not-a-uuid/unlock`, { cookie: s.cookie, csrf: s.csrf })
        .then((r) => r.statusCode),
    ).toBe(400);
    expect(
      await ctx
        .call('POST', `/api/admin/users/00000000-0000-4000-8000-000000000000/unlock`, {
          cookie: s.cookie,
          csrf: s.csrf,
        })
        .then((r) => r.statusCode),
    ).toBe(404);
  });
});

/* ═══════════════════ audit trail ═══════════════════ */

describe('audit log', () => {
  it('records the security-relevant events, newest first, and pages with a stable cursor', async () => {
    const a = await seed();
    const t = await seed({ username: 'subject', role: 'ADMIN' });
    await login(t, 'wrong-password-xxxx');
    const s = await signIn(a);
    await ctx.call('POST', '/api/admin/users', {
      cookie: s.cookie,
      csrf: s.csrf,
      body: { username: 'created.one' },
    });
    await ctx.call('POST', '/api/admin/auth/logout', { cookie: s.cookie, csrf: s.csrf });

    const s2 = await signIn(a);
    const page1 = await ctx.call('GET', '/api/admin/audit?limit=3', { cookie: s2.cookie });
    expect(page1.statusCode).toBe(200);
    const p1 = page1.json();
    expect(p1.entries).toHaveLength(3);
    expect(p1.entries.map((e: { id: number }) => e.id)).toEqual(
      [...p1.entries.map((e: { id: number }) => e.id)].sort((x, y) => y - x),
    );
    expect(p1.nextBefore).not.toBeNull();
    const page2 = (
      await ctx.call('GET', `/api/admin/audit?limit=50&before=${p1.nextBefore}`, {
        cookie: s2.cookie,
      })
    ).json();
    expect(page2.entries.every((e: { id: number }) => e.id < p1.nextBefore)).toBe(true);
    const actions = new Set(
      [...p1.entries, ...page2.entries].map((e: { action: string }) => e.action),
    );
    for (const want of ['admin.login', 'admin.login.failed', 'admin.create', 'admin.logout'])
      expect(actions.has(want), want).toBe(true);
    expect(
      (await ctx.call('GET', '/api/admin/audit?limit=0', { cookie: s2.cookie })).statusCode,
    ).toBe(400);
    expect(
      (await ctx.call('GET', '/api/admin/audit?limit=201', { cookie: s2.cookie })).statusCode,
    ).toBe(400);
  });

  it('never contains a secret: passwords, TOTP secrets, codes or tokens', async () => {
    const a = await seed({ mfa: false });
    const first = await login(a);
    const { secret } = (
      await ctx.call('POST', '/api/admin/auth/mfa/enroll/start', {
        cookie: first.cookie,
        csrf: first.csrf,
      })
    ).json();
    const code = nextCode(secret);
    const done = await ctx.call('POST', '/api/admin/auth/mfa/enroll/confirm', {
      cookie: first.cookie,
      csrf: first.csrf,
      body: { code },
    });
    const codes = done.json().recoveryCodes as string[];
    await login(a, 'definitely-wrong-password');
    const everything = JSON.stringify(await db.select().from(auditLog));
    for (const secretish of [
      PASSWORD,
      'definitely-wrong-password',
      secret,
      code,
      first.cookie!,
      first.csrf!,
      ...codes,
      ...codes.map((c) => c.replace(/-/g, '')),
    ])
      expect(everything).not.toContain(secretish);
  });

  it('is append-only even for the application role', async () => {
    const a = await seed();
    await signIn(a);
    await expect(db.update(auditLog).set({ action: 'tampered' })).rejects.toThrow();
    await expect(db.delete(auditLog)).rejects.toThrow();
  });
});

/* ═══════════════════ data at rest ═══════════════════ */

describe('data at rest', () => {
  it('the database holds no admin password, authenticator secret, recovery code or session token in clear', async () => {
    const a = await seed({ mfa: false });
    const first = await login(a);
    const { secret } = (
      await ctx.call('POST', '/api/admin/auth/mfa/enroll/start', {
        cookie: first.cookie,
        csrf: first.csrf,
      })
    ).json();
    const done = await ctx.call('POST', '/api/admin/auth/mfa/enroll/confirm', {
      cookie: first.cookie,
      csrf: first.csrf,
      body: { code: nextCode(secret) },
    });
    const dump = JSON.stringify({
      users: await db.select().from(adminUsers),
      sessions: await db.select().from(adminSessions),
      codes: await db.select().from(adminRecoveryCodes),
    });
    for (const clear of [
      PASSWORD,
      secret,
      jar(done)!,
      first.cookie!,
      ...(done.json().recoveryCodes as string[]),
    ])
      expect(dump).not.toContain(clear);
  });

  it('a TOTP ciphertext cannot be moved into another purpose', async () => {
    const a = await seed();
    const row = await adminRow(a.id);
    expect(() => cipher.decrypt(row.totpSecretEnc!, 'visitor.phone')).toThrow();
  });

  it('the database refuses an account that claims MFA without a secret', async () => {
    const a = await seed({ mfa: false });
    await expect(
      db.update(adminUsers).set({ mfaEnabled: true }).where(eq(adminUsers.id, a.id)),
    ).rejects.toThrow();
  });
});
