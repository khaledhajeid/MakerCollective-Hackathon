import { randomBytes } from 'node:crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { auditLog, displayTokens } from '../../db/schema.js';
import { sha256Hex } from '../../lib/crypto.js';
import type { Actor } from '../results/service.js';

/**
 * A display token is a 256-bit random bearer secret (`mcd_` + 43 base64url chars). Only its SHA-256 is stored:
 * the value is shown once at creation, and a database leak yields nothing a TV can use. SHA-256 (not a slow
 * password hash) is right here because the input is already 256 bits of entropy — there is nothing to brute-force.
 */
export const TOKEN_FORMAT = /^mcd_[A-Za-z0-9_-]{43}$/;

export function generateDisplayToken(): string {
  return `mcd_${randomBytes(32).toString('base64url')}`;
}

export interface DisplayIdentity {
  id: string;
  label: string;
}

export class DisplayTokenService {
  constructor(private readonly db: Database) {}

  async create(label: string, actor: Actor): Promise<DisplayIdentity & { token: string }> {
    const token = generateDisplayToken();
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(displayTokens)
        .values({ label, tokenHash: sha256Hex(token), createdBy: actor.adminId })
        .returning({ id: displayTokens.id });
      await tx.insert(auditLog).values({
        actorAdminId: actor.adminId,
        actorLabel: actor.label,
        action: 'display.create',
        entity: 'display_token',
        entityId: row!.id,
        details: { label },
        ip: actor.ip ?? null,
      });
      return { id: row!.id, label, token };
    });
  }

  /** The display behind a token, or null for anything malformed, unknown or revoked. */
  async verify(token: string): Promise<DisplayIdentity | null> {
    if (!TOKEN_FORMAT.test(token)) return null;
    const [row] = await this.db
      .select({ id: displayTokens.id, label: displayTokens.label })
      .from(displayTokens)
      .where(and(eq(displayTokens.tokenHash, sha256Hex(token)), isNull(displayTokens.revokedAt)));
    return row ?? null;
  }

  /** "Last seen" for the admin Displays page — written at most once a minute per token. */
  async touch(id: string): Promise<void> {
    await this.db
      .update(displayTokens)
      .set({ lastSeenAt: sql`now()` })
      .where(
        and(
          eq(displayTokens.id, id),
          sql`(${displayTokens.lastSeenAt} IS NULL OR ${displayTokens.lastSeenAt} < now() - interval '1 minute')`,
        ),
      );
  }

  async revoke(id: string, actor: Actor): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .update(displayTokens)
        .set({ revokedAt: sql`now()` })
        .where(and(eq(displayTokens.id, id), isNull(displayTokens.revokedAt)))
        .returning({ id: displayTokens.id, label: displayTokens.label });
      if (!rows.length) return false;
      await tx.insert(auditLog).values({
        actorAdminId: actor.adminId,
        actorLabel: actor.label,
        action: 'display.revoke',
        entity: 'display_token',
        entityId: id,
        details: { label: rows[0]!.label },
        ip: actor.ip ?? null,
      });
      return true;
    });
  }

  /**
   * Takes a display off the admin list. The API may not delete rows from this table, so it is marked removed instead,
   * and revoked in the same step when it was still active (its TV goes blank, exactly as with `revoke`).
   */
  async remove(id: string, actor: Actor): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [before] = await tx
        .select({ label: displayTokens.label, revokedAt: displayTokens.revokedAt })
        .from(displayTokens)
        .where(and(eq(displayTokens.id, id), isNull(displayTokens.removedAt)))
        .for('update');
      if (!before) return false;
      await tx
        .update(displayTokens)
        .set({ revokedAt: sql`coalesce(${displayTokens.revokedAt}, now())`, removedAt: sql`now()` })
        .where(eq(displayTokens.id, id));
      await tx.insert(auditLog).values({
        actorAdminId: actor.adminId,
        actorLabel: actor.label,
        action: 'display.remove',
        entity: 'display_token',
        entityId: id,
        details: { label: before.label, wasActive: before.revokedAt === null },
        ip: actor.ip ?? null,
      });
      return true;
    });
  }

  async list() {
    return this.db
      .select({
        id: displayTokens.id,
        label: displayTokens.label,
        createdAt: displayTokens.createdAt,
        lastSeenAt: displayTokens.lastSeenAt,
        revokedAt: displayTokens.revokedAt,
      })
      .from(displayTokens)
      .where(isNull(displayTokens.removedAt))
      .orderBy(displayTokens.createdAt);
  }

  /** Which of these tokens are still valid — the hub uses it to drop revoked TVs from open streams. */
  async activeIds(ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const rows = await this.db
      .select({ id: displayTokens.id })
      .from(displayTokens)
      .where(and(inArray(displayTokens.id, ids), isNull(displayTokens.revokedAt)));
    return new Set(rows.map((r) => r.id));
  }
}
