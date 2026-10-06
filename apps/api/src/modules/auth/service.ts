import { randomInt, randomUUID } from 'node:crypto';
import type { Locale } from '@mc/shared';
import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { Env } from '../../config/env.js';
import type { Database } from '../../db/client.js';
import { otpChallenges, visitors } from '../../db/schema.js';
import { FieldCipher, hmacHex, safeEqual } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { rateKey, parseIp } from '../../lib/ip.js';
import { normalizePhone, maskPhone } from '../../lib/phone.js';
import type { RateLimiter } from '../../lib/rate-limit.js';
import type { SettingsCache } from '../settings/cache.js';
import type { SmsProvider } from '../sms/provider.js';
import { LIMITS } from './limits.js';

export interface RequestContext {
  ip: string;
  deviceId: string;
}

export interface OtpRequestInput {
  name: string;
  phone: string;
  voteConsent: boolean;
  outreachConsent: boolean;
  locale: Locale;
}

export function otpMessage(code: string, locale: Locale, ttlSec: number, host: string): string {
  const mins = Math.max(1, Math.round(ttlSec / 60));
  // Last line follows the WebOTP format so Android Chrome can offer one-tap autofill for this origin only.
  const webOtp = `\n\n@${host} #${code}`;
  return locale === 'ar'
    ? `رمز التحقق لتصويت صنّاع ٢٠٢٦: ${code}\nصالح لمدة ${mins} دقائق. لا تشاركه مع أحد.${webOtp}`
    : `Your Maker Collective 2026 code: ${code}\nValid for ${mins} min. Never share it with anyone.${webOtp}`;
}

export class AuthService {
  private readonly cipher: FieldCipher;

  constructor(
    private readonly env: Env,
    private readonly db: Database,
    private readonly settings: SettingsCache,
    private readonly limiter: RateLimiter,
    private readonly sms: SmsProvider,
  ) {
    this.cipher = new FieldCipher(env.PII_ENCRYPTION_KEY);
  }

  private otpHash(challengeId: string, code: string): string {
    // Bound to the challenge id: a code is useless against any other challenge, and a DB leak yields
    // nothing directly usable (6-digit codes still need the pepper and expire within minutes).
    return hmacHex(this.env.PHONE_HASH_PEPPER, `otp:${challengeId}:${code}`);
  }

  private ipKey(ip: string): string {
    const parsed = parseIp(ip);
    return parsed ? rateKey(parsed) : 'unknown';
  }

  /** Seconds the phone must still wait before another code, or 0. */
  private async cooldownRemaining(
    db: Pick<Database, 'select'>,
    phoneHash: string,
    cooldownSec: number,
  ): Promise<number> {
    const [recent] = await db
      .select({
        wait: sql<number>`ceil(extract(epoch from (${otpChallenges.createdAt} + make_interval(secs => ${cooldownSec}) - now())))`,
      })
      .from(otpChallenges)
      .where(
        and(
          eq(otpChallenges.phoneHash, phoneHash),
          gt(otpChallenges.createdAt, sql`now() - make_interval(secs => ${cooldownSec})`),
        ),
      )
      .orderBy(sql`${otpChallenges.createdAt} desc`)
      .limit(1);
    return recent ? Math.max(1, Number(recent.wait)) : 0;
  }

  private async enforce(
    bucket: string,
    key: string,
    rule: { limit: number; windowSec: number },
  ): Promise<void> {
    const r = await this.limiter.hit(bucket, key, rule.limit, rule.windowSec);
    if (!r.allowed) {
      throw new AppError(429, 'RATE_LIMITED', 'Too many attempts, please wait', {
        retryAfterSeconds: r.retryAfterSec,
      });
    }
  }

  /** Step 1 — validate, throttle, create a single-use challenge and send the code. */
  async requestOtp(input: OtpRequestInput, ctx: RequestContext) {
    if (!input.voteConsent)
      throw new AppError(400, 'CONSENT_REQUIRED', 'Consent to the privacy notice is required');

    const s = await this.settings.get();
    const phone = normalizePhone(input.phone, s.allowedPhonePrefixes);
    if (!phone.ok)
      throw new AppError(400, 'PHONE_NOT_ALLOWED', 'This phone number cannot be used', {
        reason: phone.reason,
      });

    const phoneHash = hmacHex(this.env.PHONE_HASH_PEPPER, phone.e164);

    // Blocked numbers get a decoy "sent" response: no SMS, no quota spent, and the caller cannot use this
    // endpoint to learn which numbers are blocked (the real refusal happens after OTP proves ownership).
    const [known] = await this.db
      .select({ isBlocked: visitors.isBlocked })
      .from(visitors)
      .where(eq(visitors.phoneHash, phoneHash));
    if (known?.isBlocked) {
      return {
        challengeId: randomUUID(),
        maskedPhone: phone.masked,
        expiresInSeconds: s.otpTtlSeconds,
        resendAfterSeconds: s.otpResendCooldownSeconds,
      };
    }

    // Quota is spent only by requests that will actually reach the SMS gateway. A request refused by the
    // cooldown or a per-phone cap must NOT consume the shared venue-IP / global budget, otherwise one
    // person looping on one number could exhaust it for the whole venue.
    const early = await this.cooldownRemaining(this.db, phoneHash, s.otpResendCooldownSeconds);
    if (early)
      throw new AppError(429, 'OTP_RESEND_TOO_SOON', 'Please wait before requesting a new code', {
        retryAfterSeconds: early,
      });
    // Per-phone key is the HMAC, never the number.
    await this.enforce('otp-req-phone', phoneHash, LIMITS.otpRequest.perPhone);
    // The device id is a client-held cookie (clearable): a convenience limit, not a security boundary.
    await this.enforce('otp-req-dev', ctx.deviceId, LIMITS.otpRequest.perDevice);
    await this.enforce('otp-req-ip', this.ipKey(ctx.ip), LIMITS.otpRequest.perIp);
    await this.enforce('otp-global', 'all', {
      limit: this.env.OTP_GLOBAL_PER_HOUR,
      windowSec: 3_600,
    });

    const id = randomUUID();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');

    await this.db.transaction(async (tx) => {
      // Serialise concurrent requests for one phone so the cooldown cannot be raced into two SMS.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${phoneHash}, 0))`);
      const wait = await this.cooldownRemaining(tx, phoneHash, s.otpResendCooldownSeconds);
      if (wait)
        throw new AppError(429, 'OTP_RESEND_TOO_SOON', 'Please wait before requesting a new code', {
          retryAfterSeconds: wait,
        });
      await tx.insert(otpChallenges).values({
        id,
        phoneHash,
        codeHash: this.otpHash(id, code),
        nameEnc: this.cipher.encrypt(input.name.trim(), 'visitor.name'),
        phoneEnc: this.cipher.encrypt(phone.e164, 'visitor.phone'),
        outreachConsent: input.outreachConsent,
        consentVersion: s.consentVersion,
        locale: input.locale,
        expiresAt: sql`now() + make_interval(secs => ${s.otpTtlSeconds})`,
        ip: ctx.ip,
        deviceId: ctx.deviceId,
      });
    });

    try {
      await this.sms.send({
        toE164: phone.e164,
        toMasked: phone.masked,
        text: otpMessage(code, input.locale, s.otpTtlSeconds, new URL(this.env.PUBLIC_ORIGIN).host),
      });
    } catch (err) {
      // Drop only the NEW challenge: the visitor's earlier, still-valid code keeps working and the cooldown
      // is not burned by a gateway hiccup.
      await this.db.delete(otpChallenges).where(eq(otpChallenges.id, id));
      throw Object.assign(
        new AppError(502, 'SMS_UNAVAILABLE', 'Could not send the SMS, try again'),
        { cause: err },
      );
    }

    // Delivery succeeded: now retire older live codes so only the newest is valid.
    await this.db
      .update(otpChallenges)
      .set({ consumedAt: sql`now()` })
      .where(
        and(
          eq(otpChallenges.phoneHash, phoneHash),
          isNull(otpChallenges.consumedAt),
          ne(otpChallenges.id, id),
        ),
      );

    return {
      challengeId: id,
      maskedPhone: phone.masked,
      expiresInSeconds: s.otpTtlSeconds,
      resendAfterSeconds: s.otpResendCooldownSeconds,
    };
  }

  /** Step 2 — verify the code (attempt-limited, single-use) and create/refresh the visitor identity. */
  async verifyOtp(input: { challengeId: string; code: string }, ctx: RequestContext) {
    await this.enforce('otp-ver-ip', this.ipKey(ctx.ip), LIMITS.otpVerify.perIp);
    await this.enforce('otp-ver-dev', ctx.deviceId, LIMITS.otpVerify.perDevice);

    const s = await this.settings.get();
    const code = input.code.replace(/\D/g, ''); // tolerate spaces / Arabic-Indic digits normalised upstream

    // Atomically take one attempt BEFORE comparing: N parallel guesses can never exceed the cap.
    const [taken] = await this.db
      .update(otpChallenges)
      .set({ attempts: sql`${otpChallenges.attempts} + 1` })
      .where(
        and(
          eq(otpChallenges.id, input.challengeId),
          isNull(otpChallenges.consumedAt),
          gt(otpChallenges.expiresAt, sql`now()`),
          sql`${otpChallenges.attempts} < ${s.otpMaxAttempts}`,
        ),
      )
      .returning();

    if (!taken) {
      const [existing] = await this.db
        .select({
          attempts: otpChallenges.attempts,
          consumedAt: otpChallenges.consumedAt,
          expired: sql<boolean>`${otpChallenges.expiresAt} <= now()`,
        })
        .from(otpChallenges)
        .where(eq(otpChallenges.id, input.challengeId));
      if (!existing) throw new AppError(400, 'OTP_INVALID', 'Invalid code');
      if (existing.consumedAt || existing.expired)
        throw new AppError(400, 'OTP_EXPIRED', 'This code has expired, request a new one');
      throw new AppError(429, 'OTP_LOCKED', 'Too many wrong attempts, request a new code');
    }

    if (!safeEqual(this.otpHash(taken.id, code), taken.codeHash)) {
      const remaining = Math.max(0, s.otpMaxAttempts - taken.attempts);
      throw new AppError(400, 'OTP_INVALID', 'Invalid code', { attemptsRemaining: remaining });
    }

    // Consume the code and create/refresh the identity ATOMICALLY: a database blip between the two must not
    // burn the visitor's code. Only one concurrent verifier can flip consumed_at (single use).
    const visitor = await this.db.transaction(async (tx) => {
      const [consumed] = await tx
        .update(otpChallenges)
        .set({ consumedAt: sql`now()` })
        .where(and(eq(otpChallenges.id, taken.id), isNull(otpChallenges.consumedAt)))
        .returning({ id: otpChallenges.id });
      if (!consumed)
        throw new AppError(400, 'OTP_EXPIRED', 'This code has expired, request a new one');

      // One identity per real phone (UNIQUE phone_hash). Re-verification keeps the original name/phone
      // ciphertext; the visitor just re-accepted the CURRENT privacy notice, so consent version and its
      // timestamp move together (the audit trail never pairs a new version with an old date).
      const [row] = await tx
        .insert(visitors)
        .values({
          nameEnc: taken.nameEnc,
          phoneEnc: taken.phoneEnc,
          phoneHash: taken.phoneHash,
          voteConsentAt: new Date(),
          outreachConsentAt: taken.outreachConsent ? new Date() : null,
          consentVersion: taken.consentVersion,
          locale: taken.locale,
          createdIp: ctx.ip,
          deviceId: ctx.deviceId,
        })
        .onConflictDoUpdate({
          target: visitors.phoneHash,
          set: {
            locale: taken.locale,
            deviceId: ctx.deviceId,
            consentVersion: taken.consentVersion,
            voteConsentAt: sql`now()`,
            lastVerifiedAt: sql`now()`,
            outreachConsentAt: sql`coalesce(${visitors.outreachConsentAt}, ${taken.outreachConsent ? sql`now()` : sql`null`})`,
          },
        })
        .returning();
      return row!;
    });

    if (visitor.isBlocked)
      throw new AppError(403, 'VISITOR_BLOCKED', 'This number cannot be used for voting');

    return this.profile(visitor);
  }

  profile(v: { nameEnc: string; phoneEnc: string; locale: string; id: string }) {
    return {
      id: v.id,
      name: this.cipher.decrypt(v.nameEnc, 'visitor.name'),
      maskedPhone: maskPhone(this.cipher.decrypt(v.phoneEnc, 'visitor.phone')),
      locale: v.locale as Locale,
    };
  }

  /** The visitor behind a session, or null if unknown, blocked, or the session predates a logout. */
  async visitorForSession(session: { id: string; issuedAtMs: number }) {
    const [v] = await this.db.select().from(visitors).where(eq(visitors.id, session.id));
    if (!v || v.isBlocked) return null;
    if (v.sessionsRevokedAt && session.issuedAtMs <= v.sessionsRevokedAt.getTime()) return null;
    return v;
  }

  /** Logout = server-side revocation of every session issued so far (a captured cookie dies too). */
  async revokeSessions(visitorId: string): Promise<void> {
    await this.db
      .update(visitors)
      .set({ sessionsRevokedAt: sql`now()` })
      .where(eq(visitors.id, visitorId));
  }
}
