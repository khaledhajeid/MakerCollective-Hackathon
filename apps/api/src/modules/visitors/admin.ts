import type { AdminVisitor } from '@mc/shared/manage';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import type { Env } from '../../config/env.js';
import type { Database } from '../../db/client.js';
import { otpChallenges, visitors } from '../../db/schema.js';
import { FieldCipher, hmacHex } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { maskPhone, normalizePhone } from '../../lib/phone.js';
import type { RateLimiter } from '../../lib/rate-limit.js';
import { writeAudit } from '../admin/audit.js';
import type { Actor } from '../results/service.js';
import type { SettingsCache } from '../settings/cache.js';

/** "Layla Haddad" → "L••• H•••": enough to recognise the person you are talking to, not to identify anyone from a list. */
export function maskName(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => `${[...w][0]}•••`)
      .join(' ') || '•••'
  );
}

const CURSOR = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\|([0-9a-f-]{36})$/;

/**
 * What organisers may do about visitors. The list shows masked names and phones only; reading a real name and number
 * ("unmask") is a separate, SUPER_ADMIN-only, reason-required, audited act. Blocking keeps votes already cast (they
 * are final) but ends the visitor's sessions and stops any further sign-in or vote.
 */
export class VisitorAdminService {
  private readonly cipher: FieldCipher;

  constructor(
    private readonly env: Env,
    private readonly db: Database,
    private readonly settings: SettingsCache,
    private readonly limiter: RateLimiter,
  ) {
    this.cipher = new FieldCipher(env.PII_ENCRYPTION_KEY);
  }

  private async phoneHashOf(input: string): Promise<{ hash: string; masked: string }> {
    const s = await this.settings.get();
    const phone = normalizePhone(input, s.allowedPhonePrefixes);
    if (!phone.ok) throw new AppError(400, 'PHONE_NOT_ALLOWED', 'That is not a valid phone number');
    return { hash: hmacHex(this.env.PHONE_HASH_PEPPER, phone.e164), masked: phone.masked };
  }

  async list(opts: { limit: number; after?: string; phone?: string }) {
    let where = undefined;
    if (opts.phone) {
      const { hash } = await this.phoneHashOf(opts.phone);
      where = eq(visitors.phoneHash, hash);
    } else if (opts.after) {
      const m = CURSOR.exec(opts.after);
      if (!m) throw new AppError(400, 'VALIDATION_FAILED', 'Bad page cursor');
      const at = new Date(m[1]!);
      where = or(
        lt(visitors.createdAt, at),
        and(eq(visitors.createdAt, at), lt(visitors.id, m[2]!)),
      );
    }
    const rows = await this.db
      .select({
        v: visitors,
        votes: sql<number>`(SELECT count(*)::int FROM votes WHERE votes.visitor_id = "visitors"."id")`,
      })
      .from(visitors)
      .where(where)
      .orderBy(desc(visitors.createdAt), desc(visitors.id))
      .limit(opts.limit + 1);
    const more = rows.length > opts.limit;
    const page = more ? rows.slice(0, opts.limit) : rows;
    const total = await this.db.$count(visitors);
    const out: AdminVisitor[] = page.map(({ v, votes }) => ({
      id: v.id,
      name: maskName(this.cipher.decrypt(v.nameEnc, 'visitor.name')),
      phone: maskPhone(this.cipher.decrypt(v.phoneEnc, 'visitor.phone')),
      locale: v.locale as 'ar' | 'en',
      outreachConsent: v.outreachConsentAt !== null,
      votes,
      isBlocked: v.isBlocked,
      device: v.deviceId ? v.deviceId.slice(0, 6) : null,
      createdAt: v.createdAt.toISOString(),
    }));
    const last = page[page.length - 1]?.v;
    return {
      visitors: out,
      nextAfter: more && last ? `${last.createdAt.toISOString()}|${last.id}` : null,
      total,
    };
  }

  async setBlocked(id: string, blocked: boolean, actor: Actor): Promise<{ blocked: boolean }> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(visitors)
        .set({
          isBlocked: blocked, // App clock, like a visitor's own logout: the same clock that stamps a session's issue time (auth/service.ts).
          ...(blocked && { sessionsRevokedAt: new Date() }),
        })
        .where(eq(visitors.id, id))
        .returning({ id: visitors.id });
      if (!row) throw new AppError(404, 'NOT_FOUND', 'No such visitor');
      await writeAudit(tx, {
        adminId: actor.adminId,
        label: actor.label,
        action: blocked ? 'visitor.block' : 'visitor.unblock',
        entity: 'visitor',
        entityId: id,
        ip: actor.ip,
      });
    });
    return { blocked };
  }

  /** Ends every session the visitor has; they sign in again with a new SMS code. */
  async signOut(id: string, actor: Actor): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(visitors)
        .set({ sessionsRevokedAt: new Date() })
        .where(eq(visitors.id, id))
        .returning({ id: visitors.id });
      if (!row) throw new AppError(404, 'NOT_FOUND', 'No such visitor');
      await writeAudit(tx, {
        adminId: actor.adminId,
        label: actor.label,
        action: 'visitor.signout',
        entity: 'visitor',
        entityId: id,
        ip: actor.ip,
      });
    });
  }

  /** The real name and phone. SUPER_ADMIN only; the reason is recorded with the actor, the visitor and the time. */
  async unmask(id: string, reason: string, actor: Actor): Promise<{ name: string; phone: string }> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(visitors).where(eq(visitors.id, id));
      if (!row) throw new AppError(404, 'NOT_FOUND', 'No such visitor');
      await writeAudit(tx, {
        adminId: actor.adminId,
        label: actor.label,
        action: 'visitor.unmask',
        entity: 'visitor',
        entityId: id,
        details: { reason },
        ip: actor.ip,
      });
      return {
        name: this.cipher.decrypt(row.nameEnc, 'visitor.name'),
        phone: this.cipher.decrypt(row.phoneEnc, 'visitor.phone'),
      };
    });
  }

  /**
   * The answer to "someone keeps requesting codes for my number and now I am locked out" (threat model, Phase 2):
   * forget the recent codes and the hourly counter for ONE phone number. The cooldown and the attempt lock-out are read
   * from those codes, so the person can request a fresh one immediately.
   */
  async clearOtpThrottle(phone: string, actor: Actor): Promise<{ cleared: number }> {
    const { hash, masked } = await this.phoneHashOf(phone);
    const cleared = await this.db.transaction(async (tx) => {
      const gone = await tx
        .delete(otpChallenges)
        .where(eq(otpChallenges.phoneHash, hash))
        .returning({ id: otpChallenges.id });
      await writeAudit(tx, {
        adminId: actor.adminId,
        label: actor.label,
        action: 'otp.throttle.clear',
        entity: 'phone',
        entityId: masked,
        details: { challenges: gone.length },
        ip: actor.ip,
      });
      return gone.length;
    });
    await this.limiter.reset('otp-req-phone', hash);
    return { cleared };
  }
}
