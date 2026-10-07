import { randomBytes } from 'node:crypto';
import type { AdminRole } from '@mc/shared';
import { and, eq, lt, ne, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { adminSessions, adminUsers } from '../../db/schema.js';
import { randomToken, sha256Hex } from '../../lib/crypto.js';

/**
 * Admin sessions live in Postgres (any replica can serve any request, a restart signs nobody out, and an admin can
 * be signed out from the console). The cookie carries 256 random bits; only their SHA-256 is stored, so a database
 * leak yields no usable session.
 *
 * Three clocks, all enforced on every request:
 *  - a session that has not completed MFA lives 10 minutes, then dies (a stolen password alone buys almost nothing);
 *  - a full session ends after 30 minutes without a request (idle) …
 *  - … and after 8 hours regardless (absolute: it never slides).
 * The token is replaced (not just upgraded) when MFA completes or the password changes, so a token captured before
 * the privilege change is worthless after it (session fixation).
 */
export const PENDING_MS = 10 * 60_000;
export const IDLE_MS = 30 * 60_000;
export const ABSOLUTE_MS = 8 * 60 * 60_000;
/** Writing "last seen" on every request would turn each admin click into a write; once a minute is enough. */
const TOUCH_EVERY_MS = 60_000;

export const SESSION_TOKEN = /^mca_[A-Za-z0-9_-]{43}$/;
const newToken = () => `mca_${randomBytes(32).toString('base64url')}`;

export interface AdminPrincipal {
  id: string;
  username: string;
  role: AdminRole;
  mfaEnabled: boolean;
  mustChangePassword: boolean;
}

export interface ResolvedSession {
  tokenHash: string;
  csrfSecret: string;
  mfaVerified: boolean;
  expiresAt: Date;
  admin: AdminPrincipal;
}

export interface IssuedSession {
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

export interface SessionOrigin {
  ip: string | null;
  userAgent: string | null;
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export class AdminSessions {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Also usable inside a caller's transaction (promotion and password change swap sessions atomically). */
  async create(
    adminId: string,
    mfaVerified: boolean,
    origin: SessionOrigin,
    executor: Database | Tx = this.db,
  ): Promise<IssuedSession> {
    const now = this.now();
    const token = newToken();
    const csrfToken = randomToken(32);
    const expiresAt = new Date(now.getTime() + (mfaVerified ? ABSOLUTE_MS : PENDING_MS));
    await executor.insert(adminSessions).values({
      tokenHash: sha256Hex(token),
      adminId,
      csrfSecret: csrfToken,
      mfaVerified,
      ip: origin.ip,
      userAgent: origin.userAgent?.slice(0, 200) ?? null,
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
    });
    // Opportunistic housekeeping on the (rare) sign-in path: no cron needed for a table this small.
    await executor
      .delete(adminSessions)
      .where(lt(adminSessions.expiresAt, new Date(now.getTime() - 24 * 60 * 60_000)));
    return { token, csrfToken, expiresAt };
  }

  /** The live session behind a cookie value, or null (unknown, expired, idle, or the admin was disabled). */
  async resolve(token: string): Promise<ResolvedSession | null> {
    if (!SESSION_TOKEN.test(token)) return null;
    const tokenHash = sha256Hex(token);
    const [row] = await this.db
      .select({
        csrfSecret: adminSessions.csrfSecret,
        mfaVerified: adminSessions.mfaVerified,
        lastSeenAt: adminSessions.lastSeenAt,
        expiresAt: adminSessions.expiresAt,
        id: adminUsers.id,
        username: adminUsers.username,
        role: adminUsers.role,
        mfaEnabled: adminUsers.mfaEnabled,
        mustChangePassword: adminUsers.mustChangePassword,
        isDisabled: adminUsers.isDisabled,
        credentialsExpireAt: adminUsers.credentialsExpireAt,
      })
      .from(adminSessions)
      .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.adminId))
      .where(eq(adminSessions.tokenHash, tokenHash));
    if (!row) return null;

    const now = this.now();
    const dead =
      row.expiresAt <= now ||
      (row.mfaVerified && row.lastSeenAt.getTime() + IDLE_MS <= now.getTime()) ||
      row.isDisabled ||
      (row.credentialsExpireAt !== null && row.credentialsExpireAt <= now);
    if (dead) {
      await this.db.delete(adminSessions).where(eq(adminSessions.tokenHash, tokenHash));
      return null;
    }
    if (row.lastSeenAt.getTime() + TOUCH_EVERY_MS <= now.getTime()) {
      await this.db
        .update(adminSessions)
        .set({ lastSeenAt: now })
        .where(eq(adminSessions.tokenHash, tokenHash));
    }
    return {
      tokenHash,
      csrfSecret: row.csrfSecret,
      mfaVerified: row.mfaVerified,
      expiresAt: row.expiresAt,
      admin: {
        id: row.id,
        username: row.username,
        role: row.role,
        mfaEnabled: row.mfaEnabled,
        mustChangePassword: row.mustChangePassword,
      },
    };
  }

  async revoke(tokenHash: string, executor: Database | Tx = this.db): Promise<void> {
    await executor.delete(adminSessions).where(eq(adminSessions.tokenHash, tokenHash));
  }

  /** Every session of an admin; optionally keeping one. Returns how many were ended. */
  async revokeAll(
    adminId: string,
    opts: { except?: string; onlyPending?: boolean } = {},
    executor: Database | Tx = this.db,
  ): Promise<number> {
    const rows = await executor
      .delete(adminSessions)
      .where(
        and(
          eq(adminSessions.adminId, adminId),
          opts.except ? ne(adminSessions.tokenHash, opts.except) : undefined,
          opts.onlyPending ? eq(adminSessions.mfaVerified, false) : undefined,
        ),
      )
      .returning({ h: adminSessions.tokenHash });
    return rows.length;
  }

  async countFor(adminId: string): Promise<number> {
    const [r] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(adminSessions)
      .where(eq(adminSessions.adminId, adminId));
    return r?.n ?? 0;
  }
}
