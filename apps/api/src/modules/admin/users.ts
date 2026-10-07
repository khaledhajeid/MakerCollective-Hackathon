import type {
  AdminCredentialsIssuedSchema,
  AdminRole,
  AdminUser,
  CreateAdmin,
  UpdateAdmin,
} from '@mc/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { Database } from '../../db/client.js';
import { adminRecoveryCodes, adminUsers } from '../../db/schema.js';
import { AppError, pgErrorCode } from '../../lib/errors.js';
import type { Actor } from '../results/service.js';
import { writeAudit } from './audit.js';
import { generatePassword, hashPassword } from './password.js';
import type { AdminSessions } from './sessions.js';

/** An operator-issued password is good for this long if nobody signs in with it (then it must be re-issued). */
export const TEMP_CREDENTIAL_HOURS = 48;

export type CredentialsIssued = z.infer<typeof AdminCredentialsIssuedSchema>;

type Row = typeof adminUsers.$inferSelect;

/**
 * Admin accounts. The console (SUPER_ADMIN only) and the operator CLI both go through this one service, so the
 * rules hold on every path: nobody changes their own role or disables themselves, the last active SUPER_ADMIN can
 * never be removed, and every change is audited in the same transaction as the change itself.
 */
export class AdminUserService {
  constructor(
    private readonly db: Database,
    private readonly sessions: AdminSessions,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private toUser(r: Row): AdminUser {
    const now = this.now();
    return {
      id: r.id,
      username: r.username,
      role: r.role,
      mfaEnabled: r.mfaEnabled,
      isDisabled: r.isDisabled,
      mustChangePassword: r.mustChangePassword,
      lockedUntil: r.lockedUntil && r.lockedUntil > now ? r.lockedUntil.toISOString() : null,
      lastLoginAt: r.lastLoginAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  async list(): Promise<AdminUser[]> {
    const rows = await this.db.select().from(adminUsers).orderBy(asc(adminUsers.createdAt));
    return rows.map((r) => this.toUser(r));
  }

  async create(input: CreateAdmin, actor: Actor): Promise<CredentialsIssued> {
    const temporaryPassword = generatePassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const now = this.now();
    const expiresAt = new Date(now.getTime() + TEMP_CREDENTIAL_HOURS * 3_600_000);
    try {
      const row = await this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(adminUsers)
          .values({
            username: input.username,
            passwordHash,
            role: input.role,
            mustChangePassword: true,
            credentialsExpireAt: expiresAt,
          })
          .returning();
        await writeAudit(tx, {
          adminId: actor.adminId,
          label: actor.label,
          action: 'admin.create',
          entity: 'admin',
          entityId: created!.id,
          details: { username: input.username, role: input.role },
          ip: actor.ip,
        });
        return created!;
      });
      return { user: this.toUser(row), temporaryPassword, expiresAt: expiresAt.toISOString() };
    } catch (err) {
      if (pgErrorCode(err) === '23505')
        throw new AppError(409, 'CONFLICT', 'That username is already taken');
      throw err;
    }
  }

  async update(id: string, patch: UpdateAdmin, actor: Actor): Promise<AdminUser> {
    return this.db.transaction(async (tx) => {
      // ONE lock order for every concurrent change: the set of active SUPER_ADMINs (by id) first, then the target.
      // Locking the target first and the set second lets two changes that cross over deadlock (Postgres aborts one
      // with a 500 instead of the intended 409). It also serialises two SUPER_ADMINs demoting each other.
      const activeSupers = await tx
        .select({ id: adminUsers.id })
        .from(adminUsers)
        .where(and(eq(adminUsers.role, 'SUPER_ADMIN'), eq(adminUsers.isDisabled, false)))
        .orderBy(asc(adminUsers.id))
        .for('update');
      const [target] = await tx
        .select()
        .from(adminUsers)
        .where(eq(adminUsers.id, id))
        .for('update');
      if (!target) throw new AppError(404, 'NOT_FOUND', 'No such admin');
      if (actor.adminId === id)
        throw new AppError(
          409,
          'CONFLICT',
          'You cannot change your own role or disable your own account',
        );
      const losesSuper =
        target.role === 'SUPER_ADMIN' &&
        !target.isDisabled &&
        ((patch.role !== undefined && patch.role !== 'SUPER_ADMIN') || patch.isDisabled === true);
      if (losesSuper && activeSupers.length <= 1)
        throw new AppError(409, 'CONFLICT', 'There must always be one active SUPER_ADMIN');

      const [row] = await tx
        .update(adminUsers)
        .set({
          ...(patch.role !== undefined && { role: patch.role as AdminRole }),
          ...(patch.isDisabled !== undefined && { isDisabled: patch.isDisabled }),
        })
        .where(eq(adminUsers.id, id))
        .returning();
      if (patch.isDisabled === true) await this.sessions.revokeAll(id, {}, tx);
      await writeAudit(tx, {
        adminId: actor.adminId,
        label: actor.label,
        action: 'admin.update',
        entity: 'admin',
        entityId: id,
        details: {
          username: target.username,
          ...(patch.role !== undefined && { role: { from: target.role, to: patch.role } }),
          ...(patch.isDisabled !== undefined && {
            isDisabled: { from: target.isDisabled, to: patch.isDisabled },
          }),
        },
        ip: actor.ip,
      });
      return this.toUser(row!);
    });
  }

  /** Clears a sign-in lock-out (the break-glass for a locked-out organiser). */
  async unlock(id: string, actor: Actor): Promise<AdminUser> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(adminUsers)
        .set({ failedAttempts: 0, lockedUntil: null })
        .where(eq(adminUsers.id, id))
        .returning();
      if (!row) throw new AppError(404, 'NOT_FOUND', 'No such admin');
      await writeAudit(tx, {
        adminId: actor.adminId,
        label: actor.label,
        action: 'admin.unlock',
        entity: 'admin',
        entityId: id,
        details: { username: row.username },
        ip: actor.ip,
      });
      return this.toUser(row);
    });
  }

  /**
   * Lost password, lost phone, or both: ONE operation that voids everything the person had (password, authenticator,
   * recovery codes, sessions) and issues a temporary password. Resetting only the authenticator would let anyone who
   * knows the password enrol their own device, so the two are never separated.
   */
  async resetCredentials(id: string, actor: Actor): Promise<CredentialsIssued> {
    if (actor.adminId === id)
      throw new AppError(409, 'CONFLICT', 'Use "change password" for your own account');
    const temporaryPassword = generatePassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const expiresAt = new Date(this.now().getTime() + TEMP_CREDENTIAL_HOURS * 3_600_000);
    const row = await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(adminUsers)
        .set({
          passwordHash,
          mustChangePassword: true,
          credentialsExpireAt: expiresAt,
          mfaEnabled: false,
          totpSecretEnc: null,
          totpLastStep: null,
          failedAttempts: 0,
          lockedUntil: null,
        })
        .where(eq(adminUsers.id, id))
        .returning();
      if (!updated) throw new AppError(404, 'NOT_FOUND', 'No such admin');
      await tx.delete(adminRecoveryCodes).where(eq(adminRecoveryCodes.adminId, id));
      await this.sessions.revokeAll(id, {}, tx);
      await writeAudit(tx, {
        adminId: actor.adminId,
        label: actor.label,
        action: 'admin.credentials.reset',
        entity: 'admin',
        entityId: id,
        details: { username: updated.username },
        ip: actor.ip,
      });
      return updated;
    });
    return { user: this.toUser(row), temporaryPassword, expiresAt: expiresAt.toISOString() };
  }

  async signOut(id: string, actor: Actor): Promise<{ ended: number }> {
    return this.db.transaction(async (tx) => {
      const [target] = await tx.select().from(adminUsers).where(eq(adminUsers.id, id));
      if (!target) throw new AppError(404, 'NOT_FOUND', 'No such admin');
      const ended = await this.sessions.revokeAll(id, {}, tx);
      await writeAudit(tx, {
        adminId: actor.adminId,
        label: actor.label,
        action: 'admin.signout',
        entity: 'admin',
        entityId: id,
        details: { username: target.username, sessions: ended },
        ip: actor.ip,
      });
      return { ended };
    });
  }
}
