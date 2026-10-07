import type { AdminRole } from '@mc/shared';

/**
 * The authorisation matrix: every capability an admin route can demand, and the roles that hold it.
 * It is data on purpose: one table to review, and one test (the *authorisation (RBAC)* suite in `test/integration/admin.test.ts`) that walks it and every registered
 * route, so a new route cannot ship without an explicit decision. A route that declares no access is refused at
 * boot (see guard.ts), and an unknown permission does not typecheck.
 *
 * `DISPLAY` (a TV) is not a role in this table: displays authenticate with their own revocable token, can only
 * read the results frame, and never reach `/api/admin` at all (ADR-006, ADR-007).
 */
export const PERMISSIONS = {
  'admins.read': ['SUPER_ADMIN'],
  'admins.manage': ['SUPER_ADMIN'],
  'audit.read': ['SUPER_ADMIN'],
} as const satisfies Record<string, readonly AdminRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export const can = (role: AdminRole, permission: Permission): boolean =>
  (PERMISSIONS[permission] as readonly AdminRole[]).includes(role);

/**
 * What a route requires of the caller, declared in its `config.access`:
 *  - `public`   no session (sign-in only)
 *  - `pending`  any valid session, even one still waiting for its second factor (MFA, logout, session probe)
 *  - `mfa`      a session that completed MFA; may still owe a password change (the change-password route)
 *  - a permission: MFA done, no password change owed, and the role holds the permission
 */
export type Access = 'public' | 'pending' | 'mfa' | Permission;
