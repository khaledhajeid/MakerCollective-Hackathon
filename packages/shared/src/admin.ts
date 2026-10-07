import { z } from 'zod';
import { ADMIN_ROLES } from './constants.js';

/** Admin console contracts (ADR-007). The same schemas validate requests on the API and type the console. */

export const ADMIN_USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

/**
 * Where a signed-in browser stands. Only `ready` reaches the console; every other stage leads to exactly one screen:
 *  - `mfa`      password accepted, authenticator code (or recovery code) needed
 *  - `enroll`   password accepted, no authenticator enrolled yet
 *  - `password` second factor done, but the operator-issued password must be replaced
 *  - `ready`    fully signed in
 */
export const ADMIN_STAGES = ['mfa', 'enroll', 'password', 'ready'] as const;
export type AdminStage = (typeof ADMIN_STAGES)[number];

export const AdminRoleSchema = z.enum(ADMIN_ROLES);

export const AdminLoginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1).max(64),
  // Longer than any accepted password so a policy mismatch is a normal "wrong credentials", never a 400 oracle.
  password: z.string().min(1).max(256),
});
export type AdminLogin = z.infer<typeof AdminLoginSchema>;

const SessionAdminSchema = z.object({ username: z.string(), role: AdminRoleSchema });

export const AdminSessionSchema = z.discriminatedUnion('authenticated', [
  z.object({ authenticated: z.literal(false) }),
  z.object({
    authenticated: z.literal(true),
    stage: z.enum(ADMIN_STAGES),
    admin: SessionAdminSchema,
    /** Sent back in the `x-csrf-token` header on every state-changing request. */
    csrfToken: z.string(),
  }),
]);
export type AdminSessionInfo = z.infer<typeof AdminSessionSchema>;

const TotpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'six digits');

export const MfaVerifySchema = z.union([
  z.object({ code: TotpCodeSchema }).strict(),
  z.object({ recoveryCode: z.string().trim().min(8).max(32) }).strict(),
]);
export type MfaVerify = z.infer<typeof MfaVerifySchema>;

export const MfaEnrollStartSchema = z.object({
  /** Base32 secret for manual entry. Shown once per enrolment attempt. */
  secret: z.string(),
  /** `otpauth://` URI the console renders as a QR code. */
  otpauthUri: z.string(),
});

export const MfaEnrollConfirmSchema = z.object({ code: TotpCodeSchema }).strict();

export const RecoveryCodesSchema = z.object({
  /** Shown exactly once. Only keyed hashes are stored. */
  recoveryCodes: z.array(z.string()),
});

export const MfaVerifiedSchema = z.object({
  session: AdminSessionSchema,
  /** Set when a recovery code was used: how many are left (so the console can warn before they run out). */
  recoveryCodesRemaining: z.number().int().nullable(),
});

export const MfaEnrolledSchema = z.object({
  recoveryCodes: z.array(z.string()),
  session: AdminSessionSchema,
});

export const PasswordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(1).max(256),
});
export type PasswordChange = z.infer<typeof PasswordChangeSchema>;

/* ───────────── admin accounts (SUPER_ADMIN) ───────────── */

export const AdminUserSchema = z.object({
  id: z.uuid(),
  username: z.string(),
  role: AdminRoleSchema,
  mfaEnabled: z.boolean(),
  isDisabled: z.boolean(),
  mustChangePassword: z.boolean(),
  lockedUntil: z.iso.datetime().nullable(),
  lastLoginAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type AdminUser = z.infer<typeof AdminUserSchema>;

export const CreateAdminSchema = z.object({
  username: z.string().trim().toLowerCase().regex(ADMIN_USERNAME_RE, '3-32 of a-z 0-9 . _ -'),
  role: AdminRoleSchema.default('ADMIN'),
});
export type CreateAdmin = z.infer<typeof CreateAdminSchema>;

/** The temporary password is returned once, here, and is never retrievable again. */
export const AdminCredentialsIssuedSchema = z.object({
  user: AdminUserSchema,
  temporaryPassword: z.string(),
  expiresAt: z.iso.datetime(),
});

export const UpdateAdminSchema = z
  .object({ role: AdminRoleSchema.optional(), isDisabled: z.boolean().optional() })
  .strict()
  .refine((v) => v.role !== undefined || v.isDisabled !== undefined, 'nothing to change');
export type UpdateAdmin = z.infer<typeof UpdateAdminSchema>;

export const AuditEntrySchema = z.object({
  id: z.number().int(),
  at: z.iso.datetime(),
  actor: z.string(),
  action: z.string(),
  entity: z.string().nullable(),
  entityId: z.string().nullable(),
  details: z.unknown().nullable(),
  ip: z.string().nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const AuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Keyset cursor: return entries with an id below this one. */
  before: z.coerce.number().int().positive().optional(),
});
export const AuditPageSchema = z.object({
  entries: z.array(AuditEntrySchema),
  nextBefore: z.number().int().nullable(),
});
