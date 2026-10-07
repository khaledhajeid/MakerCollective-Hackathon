import type {
  AdminLogin,
  AdminSessionInfo,
  AdminStage,
  MfaVerify,
  PasswordChange,
} from '@mc/shared';
import { and, count, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { Env } from '../../config/env.js';
import type { Database, Tx } from '../../db/client.js';
import { adminRecoveryCodes, adminUsers } from '../../db/schema.js';
import { FieldCipher } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import type { RateLimiter } from '../../lib/rate-limit.js';
import { writeAudit } from './audit.js';
import { checkPassword, dummyHash, hashPassword, needsRehash, verifyPassword } from './password.js';
import {
  RECOVERY_CODE_COUNT,
  generateRecoveryCode,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from './recovery.js';
import type { AdminSessions, IssuedSession, ResolvedSession, SessionOrigin } from './sessions.js';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp.js';

type SignedInView = Extract<AdminSessionInfo, { authenticated: true }>;

/** Five wrong answers (password or second factor) lock sign-in for 5 min; each further five doubles it, capped at 1 h. */
const LOCK_EVERY = 5;
const LOCK_BASE_MIN = 5;
const LOCK_MAX_MIN = 60;
const ISSUER = 'MC2026';

export interface SignedIn {
  session: IssuedSession;
  view: SignedInView;
}

/** One message for every way sign-in can fail: unknown user, wrong password, locked, disabled, expired. */
const refused = () =>
  new AppError(401, 'UNAUTHENTICATED', 'Sign-in failed. Check your details and try again.');

export const stageOf = (
  admin: { mfaEnabled: boolean; mustChangePassword: boolean },
  mfaVerified: boolean,
): AdminStage => {
  if (!mfaVerified) return admin.mfaEnabled ? 'mfa' : 'enroll';
  return admin.mustChangePassword ? 'password' : 'ready';
};

export function viewOf(
  admin: {
    username: string;
    role: SignedInView['admin']['role'];
    mfaEnabled: boolean;
    mustChangePassword: boolean;
  },
  mfaVerified: boolean,
  csrfToken: string,
): SignedInView {
  return {
    authenticated: true,
    stage: stageOf(admin, mfaVerified),
    admin: { username: admin.username, role: admin.role },
    csrfToken,
  };
}

/**
 * The admin sign-in state machine (ADR-007):
 *   password ──► [enrol authenticator] ──► code / recovery code ──► [replace temporary password] ──► ready
 * Each arrow is a server-checked transition on a stored session, never a flag the browser can set. A session
 * that has not finished MFA is rejected by the route guard everywhere except the MFA routes themselves.
 */
export class AdminAuthService {
  private readonly cipher: FieldCipher;

  constructor(
    private readonly env: Env,
    private readonly db: Database,
    private readonly sessions: AdminSessions,
    private readonly limiter: RateLimiter,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.cipher = new FieldCipher(env.PII_ENCRYPTION_KEY);
    // Pay for the decoy hash now, not on the first unknown-username sign-in: otherwise that one request would be
    // twice as slow as any other, which is exactly the signal the decoy exists to remove.
    void dummyHash().catch(() => undefined);
  }

  /* ───────────── step 1: password ───────────── */

  async login(input: AdminLogin, ctx: SessionOrigin): Promise<SignedIn> {
    // Throttle BEFORE any hashing: the limiter is the cheap gate in front of the expensive one. It is per ADDRESS
    // only. A per-username limit would let anyone exhaust it for a known name and turn away the real admin even with
    // the right password, a cheaper lock-out than the account lock itself; guessing against one account is what the
    // lock is for.
    await this.limit('admin-login-ip', ctx.ip ?? 'unknown', 30, 600);

    const [admin] = await this.db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.username, input.username));
    // Always pay one full verification (a real hash for a real account, a decoy otherwise), so neither the
    // response time nor the work done tells an attacker which usernames exist or which are locked.
    const passwordOk = await verifyPassword(
      input.password,
      admin?.passwordHash ?? (await dummyHash()),
    );
    if (!admin) throw refused();

    const now = this.now();
    const reason = admin.isDisabled
      ? 'disabled'
      : admin.lockedUntil && admin.lockedUntil > now
        ? 'locked'
        : admin.credentialsExpireAt && admin.credentialsExpireAt <= now
          ? 'credentials_expired'
          : null;
    if (reason) {
      // Only a refusal that came with the CORRECT password is worth a row (someone really tried to use a disabled or
      // expired account). Without that, anyone could fill the permanent log by hammering a disabled username.
      if (passwordOk && reason !== 'locked')
        await writeAudit(this.db, {
          adminId: admin.id,
          label: `admin:${admin.username}`,
          action: 'admin.login.refused',
          entity: 'admin',
          entityId: admin.id,
          details: { reason },
          ip: ctx.ip,
        });
      throw refused();
    }
    if (!passwordOk) {
      await this.recordFailure(admin.id, admin.username, 'password', ctx);
      throw refused();
    }

    if (needsRehash(admin.passwordHash)) {
      const upgraded = await hashPassword(input.password);
      await this.db
        .update(adminUsers)
        .set({ passwordHash: upgraded })
        .where(eq(adminUsers.id, admin.id));
    }
    // A password alone does NOT clear the failure counter: only a completed second factor does. Otherwise
    // someone holding the password could reset the counter by logging in again and guess codes without limit.
    const session = await this.sessions.create(admin.id, false, ctx);
    return { session, view: viewOf(admin, false, session.csrfToken) };
  }

  /* ───────────── step 2: second factor ───────────── */

  async verifyMfa(
    current: ResolvedSession,
    input: MfaVerify,
    ctx: SessionOrigin,
  ): Promise<SignedIn & { recoveryCodesRemaining: number | null }> {
    if (current.mfaVerified) throw new AppError(409, 'CONFLICT', 'Already signed in');
    if (!current.admin.mfaEnabled)
      throw new AppError(403, 'MFA_REQUIRED', 'Set up your authenticator app first');
    await this.limit('admin-mfa-session', current.tokenHash, 8, 600);
    await this.limit('admin-mfa-ip', ctx.ip ?? 'unknown', 100, 600);

    const [admin] = await this.db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.id, current.admin.id));
    const now = this.now();
    if (!admin || admin.isDisabled || (admin.lockedUntil && admin.lockedUntil > now)) {
      await this.sessions.revoke(current.tokenHash);
      throw refused();
    }

    const method = 'code' in input ? 'totp' : 'recovery';
    // The credential is spent in the SAME transaction that issues the session: a failure after the claim rolls the
    // claim back, so an admin never loses a recovery code (or a time-step) without getting in.
    const session = await this.db.transaction(async (tx) => {
      const accepted =
        'code' in input
          ? await this.claimTotp(admin, input.code, tx)
          : await this.claimRecoveryCode(admin.id, input.recoveryCode, tx);
      if (!accepted) return null;
      await tx
        .update(adminUsers)
        .set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: now })
        .where(eq(adminUsers.id, admin.id));
      await this.sessions.revoke(current.tokenHash, tx);
      const issued = await this.sessions.create(admin.id, true, ctx, tx);
      await writeAudit(tx, {
        adminId: admin.id,
        label: `admin:${admin.username}`,
        action: 'admin.login',
        entity: 'admin',
        entityId: admin.id,
        details: { method },
        ip: ctx.ip,
      });
      return issued;
    });
    if (!session) {
      await this.recordFailure(admin.id, admin.username, method, ctx);
      throw new AppError(401, 'UNAUTHENTICATED', 'That code did not work. Check it and try again.');
    }
    const remaining = method === 'recovery' ? await this.remainingRecoveryCodes(admin.id) : null;
    return {
      session,
      view: viewOf(admin, true, session.csrfToken),
      recoveryCodesRemaining: remaining,
    };
  }

  /** A TOTP code, each time-step usable exactly once. The claim is a single conditional UPDATE, so two parallel
   *  requests carrying the same code cannot both pass. */
  private async claimTotp(
    admin: { id: string; totpSecretEnc: string | null; totpLastStep: number | null },
    code: string,
    executor: Database | Tx = this.db,
  ): Promise<boolean> {
    if (!admin.totpSecretEnc) return false;
    const secret = this.cipher.decrypt(admin.totpSecretEnc, 'admin.totp');
    const step = verifyTotp(secret, code, this.now().getTime(), admin.totpLastStep);
    if (step === null) return false;
    const claimed = await executor
      .update(adminUsers)
      .set({ totpLastStep: step })
      .where(
        and(
          eq(adminUsers.id, admin.id),
          or(isNull(adminUsers.totpLastStep), lt(adminUsers.totpLastStep, step)),
        ),
      )
      .returning({ id: adminUsers.id });
    return claimed.length === 1;
  }

  private async claimRecoveryCode(
    adminId: string,
    raw: string,
    executor: Database | Tx = this.db,
  ): Promise<boolean> {
    const normalized = normalizeRecoveryCode(raw);
    if (!normalized) return false;
    const used = await executor
      .update(adminRecoveryCodes)
      .set({ usedAt: this.now() })
      .where(
        and(
          eq(adminRecoveryCodes.adminId, adminId),
          eq(adminRecoveryCodes.codeHash, this.recoveryHash(normalized)),
          isNull(adminRecoveryCodes.usedAt),
        ),
      )
      .returning({ id: adminRecoveryCodes.id });
    return used.length === 1;
  }

  /** Keyed with the PII key, not SESSION_SECRET: rotating the cookie secret (routine after a scare) must not silently void
   *  every admin's recovery codes. */
  private recoveryHash(normalized: string): string {
    return hashRecoveryCode(this.env.PII_ENCRYPTION_KEY, normalized);
  }

  /** Replaces ALL of an admin's recovery codes with a fresh set; returns the codes (the only time they exist in clear). */
  private async issueRecoveryCodes(tx: Tx, adminId: string): Promise<string[]> {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
    await tx.delete(adminRecoveryCodes).where(eq(adminRecoveryCodes.adminId, adminId));
    await tx
      .insert(adminRecoveryCodes)
      .values(
        codes.map((c) => ({ adminId, codeHash: this.recoveryHash(normalizeRecoveryCode(c)!) })),
      );
    return codes;
  }

  /**
   * While an account is locked, a signed-in session may not keep guessing at the sensitive prompts either (current
   * password, authenticator code): the lock bounds those guesses to a handful per lock period. The session itself is
   * left alone, so a stranger who merely locked the account cannot throw the real admin out.
   */
  private refuseWhileLocked(admin: { lockedUntil: Date | null }): void {
    const now = this.now();
    if (admin.lockedUntil && admin.lockedUntil > now)
      throw new AppError(429, 'RATE_LIMITED', 'Too many wrong answers, please wait', {
        retryAfterSeconds: Math.ceil((admin.lockedUntil.getTime() - now.getTime()) / 1000),
      });
  }

  private async remainingRecoveryCodes(adminId: string): Promise<number> {
    const [r] = await this.db
      .select({ n: count() })
      .from(adminRecoveryCodes)
      .where(and(eq(adminRecoveryCodes.adminId, adminId), isNull(adminRecoveryCodes.usedAt)));
    return r?.n ?? 0;
  }

  /* ───────────── enrolment ───────────── */

  /** Issues (or re-issues, until confirmed) the authenticator secret. It only counts once a code proves it. */
  async startEnrolment(current: ResolvedSession) {
    if (current.mfaVerified || current.admin.mfaEnabled)
      throw new AppError(409, 'CONFLICT', 'An authenticator is already set up');
    await this.limit('admin-enrol', current.admin.id, 10, 600);
    const secret = generateTotpSecret();
    const updated = await this.db
      .update(adminUsers)
      .set({ totpSecretEnc: this.cipher.encrypt(secret, 'admin.totp') })
      .where(and(eq(adminUsers.id, current.admin.id), eq(adminUsers.mfaEnabled, false)))
      .returning({ id: adminUsers.id });
    if (updated.length !== 1)
      throw new AppError(409, 'CONFLICT', 'An authenticator is already set up');
    return { secret, otpauthUri: otpauthUri(secret, current.admin.username, ISSUER) };
  }

  async confirmEnrolment(current: ResolvedSession, code: string, ctx: SessionOrigin) {
    if (current.mfaVerified || current.admin.mfaEnabled)
      throw new AppError(409, 'CONFLICT', 'An authenticator is already set up');
    await this.limit('admin-mfa-session', current.tokenHash, 8, 600);

    const now = this.now();
    const outcome = await this.db.transaction(async (tx) => {
      const [admin] = await tx
        .select()
        .from(adminUsers)
        .where(eq(adminUsers.id, current.admin.id))
        .for('update');
      if (!admin || admin.mfaEnabled)
        throw new AppError(409, 'CONFLICT', 'An authenticator is already set up');
      if (admin.lockedUntil && admin.lockedUntil > now) throw refused();
      const step = admin.totpSecretEnc
        ? verifyTotp(
            this.cipher.decrypt(admin.totpSecretEnc, 'admin.totp'),
            code,
            now.getTime(),
            null,
          )
        : null;
      if (step === null) return null;

      await tx
        .update(adminUsers)
        .set({
          mfaEnabled: true,
          totpLastStep: step,
          failedAttempts: 0,
          lockedUntil: null,
          lastLoginAt: now,
        })
        .where(eq(adminUsers.id, admin.id));
      const recoveryCodes = await this.issueRecoveryCodes(tx, admin.id);
      await this.sessions.revoke(current.tokenHash, tx);
      const session = await this.sessions.create(admin.id, true, ctx, tx);
      await writeAudit(tx, {
        adminId: admin.id,
        label: `admin:${admin.username}`,
        action: 'admin.mfa.enrolled',
        entity: 'admin',
        entityId: admin.id,
        ip: ctx.ip,
      });
      return { session, recoveryCodes, admin: { ...admin, mfaEnabled: true } };
    });
    if (!outcome) {
      await this.recordFailure(current.admin.id, current.admin.username, 'totp', ctx);
      throw new AppError(401, 'UNAUTHENTICATED', 'That code did not work. Check it and try again.');
    }
    return {
      recoveryCodes: outcome.recoveryCodes,
      session: outcome.session,
      view: viewOf(outcome.admin, true, outcome.session.csrfToken),
    };
  }

  /** New recovery codes replace ALL old ones. Needs a fresh authenticator code: a stolen session alone cannot do it. */
  async regenerateRecoveryCodes(current: ResolvedSession, code: string, ctx: SessionOrigin) {
    await this.limit('admin-mfa-session', current.tokenHash, 8, 600);
    const [admin] = await this.db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.id, current.admin.id));
    if (!admin) throw refused();
    this.refuseWhileLocked(admin);
    const recoveryCodes = await this.db.transaction(async (tx) => {
      if (!(await this.claimTotp(admin, code, tx))) return null;
      const codes = await this.issueRecoveryCodes(tx, admin.id);
      await writeAudit(tx, {
        adminId: admin.id,
        label: `admin:${admin.username}`,
        action: 'admin.recovery.regenerated',
        entity: 'admin',
        entityId: admin.id,
        ip: ctx.ip,
      });
      return codes;
    });
    if (!recoveryCodes) {
      await this.recordFailure(admin.id, admin.username, 'totp', ctx);
      throw new AppError(401, 'UNAUTHENTICATED', 'That code did not work. Check it and try again.');
    }
    return { recoveryCodes };
  }

  /* ───────────── password change & sign-out ───────────── */

  /** Replaces the password, ends EVERY session (including this one) and issues a fresh one. */
  async changePassword(
    current: ResolvedSession,
    input: PasswordChange,
    ctx: SessionOrigin,
  ): Promise<SignedIn> {
    await this.limit('admin-pwchange', current.admin.id, 10, 600);
    const [admin] = await this.db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.id, current.admin.id));
    if (!admin) throw refused();
    this.refuseWhileLocked(admin);
    if (!(await verifyPassword(input.currentPassword, admin.passwordHash))) {
      await this.recordFailure(admin.id, admin.username, 'password', ctx);
      throw new AppError(400, 'VALIDATION_FAILED', 'Your current password is not correct', {
        problem: 'current_incorrect',
      });
    }
    const problem = checkPassword(input.newPassword, {
      username: admin.username,
      sameAs: input.currentPassword,
    });
    if (problem)
      throw new AppError(400, 'VALIDATION_FAILED', 'That password is not allowed', { problem });

    const passwordHash = await hashPassword(input.newPassword);
    const now = this.now();
    const session = await this.db.transaction(async (tx) => {
      await tx
        .update(adminUsers)
        .set({
          passwordHash,
          passwordChangedAt: now,
          mustChangePassword: false,
          credentialsExpireAt: null,
          failedAttempts: 0,
          lockedUntil: null,
        })
        .where(eq(adminUsers.id, admin.id));
      await this.sessions.revokeAll(admin.id, {}, tx);
      const issued = await this.sessions.create(admin.id, true, ctx, tx);
      await writeAudit(tx, {
        adminId: admin.id,
        label: `admin:${admin.username}`,
        action: 'admin.password.changed',
        entity: 'admin',
        entityId: admin.id,
        ip: ctx.ip,
      });
      return issued;
    });
    return {
      session,
      view: viewOf({ ...admin, mustChangePassword: false }, true, session.csrfToken),
    };
  }

  async logout(current: ResolvedSession, ctx: SessionOrigin): Promise<void> {
    await this.sessions.revoke(current.tokenHash);
    if (current.mfaVerified)
      await writeAudit(this.db, {
        adminId: current.admin.id,
        label: `admin:${current.admin.username}`,
        action: 'admin.logout',
        entity: 'admin',
        entityId: current.admin.id,
        ip: ctx.ip,
      });
  }

  sessionView(current: ResolvedSession): SignedInView {
    return viewOf(current.admin, current.mfaVerified, current.csrfSecret);
  }

  /* ───────────── shared ───────────── */

  /** Counts a wrong password or code; the 5th, 10th, 15th… wrong answer in a row locks sign-in for longer each time. */
  private async recordFailure(
    adminId: string,
    username: string,
    factor: 'password' | 'totp' | 'recovery',
    ctx: SessionOrigin,
  ): Promise<void> {
    const now = this.now();
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(adminUsers)
        .set({ failedAttempts: sql`${adminUsers.failedAttempts} + 1` })
        .where(eq(adminUsers.id, adminId))
        .returning({ attempts: adminUsers.failedAttempts });
      const attempts = row?.attempts ?? 0;
      await writeAudit(tx, {
        adminId,
        label: `admin:${username}`,
        action: 'admin.login.failed',
        entity: 'admin',
        entityId: adminId,
        details: { factor, attempts },
        ip: ctx.ip,
      });
      if (attempts > 0 && attempts % LOCK_EVERY === 0) {
        const minutes = Math.min(LOCK_MAX_MIN, LOCK_BASE_MIN * 2 ** (attempts / LOCK_EVERY - 1));
        await tx
          .update(adminUsers)
          .set({ lockedUntil: new Date(now.getTime() + minutes * 60_000) })
          .where(eq(adminUsers.id, adminId));
        // A lock ends sign-ins in progress; sessions that are already fully signed in are left alone, so an attacker
        // who merely knows a username cannot throw an admin out mid-event.
        await this.sessions.revokeAll(adminId, { onlyPending: true }, tx);
        await writeAudit(tx, {
          adminId,
          label: `admin:${username}`,
          action: 'admin.account.locked',
          entity: 'admin',
          entityId: adminId,
          details: { minutes, attempts },
          ip: ctx.ip,
        });
      }
    });
  }

  private async limit(
    bucket: string,
    key: string,
    limit: number,
    windowSec: number,
  ): Promise<void> {
    const hit = await this.limiter.hit(bucket, key, limit, windowSec);
    if (!hit.allowed)
      throw new AppError(429, 'RATE_LIMITED', 'Too many attempts, please wait', {
        retryAfterSeconds: hit.retryAfterSec,
      });
  }
}
