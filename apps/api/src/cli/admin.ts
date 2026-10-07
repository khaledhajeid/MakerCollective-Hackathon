/**
 * Operator tool for admin accounts. It is the bootstrap path (the first SUPER_ADMIN has to come from somewhere) and
 * the break-glass path (a locked-out or phone-less organiser at the event). The console uses the same service.
 *   ops:admin create <username> <SUPER_ADMIN|ADMIN>   → prints a temporary password ONCE
 *   ops:admin list
 *   ops:admin unlock <username>
 *   ops:admin reset <username>                        → new temporary password; password, MFA, sessions all voided
 *   ops:admin disable <username> | enable <username>
 * In the Docker stack: pnpm stack:admin create khaled SUPER_ADMIN
 */
import { ADMIN_ROLES, CreateAdminSchema, type AdminRole } from '@mc/shared';
import { eq } from 'drizzle-orm';
import { loadEnv } from '../config/env.js';
import { createDb } from '../db/client.js';
import { adminUsers } from '../db/schema.js';
import { AdminSessions } from '../modules/admin/sessions.js';
import { AdminUserService } from '../modules/admin/users.js';

const actor = { adminId: null, label: 'cli:operator' };
const [cmd, username, roleArg] = process.argv.slice(2);

const env = loadEnv();
const { pool, db } = createDb(env.DATABASE_URL, 2);
const users = new AdminUserService(db, new AdminSessions(db));

async function idOf(name: string | undefined): Promise<string> {
  if (!name) throw new Error('give a username (see `list`)');
  const [row] = await db
    .select({ id: adminUsers.id })
    .from(adminUsers)
    .where(eq(adminUsers.username, name.toLowerCase()));
  if (!row) throw new Error(`no admin called "${name}"`);
  return row.id;
}

function printCredentials(r: {
  user: { username: string; role: string };
  temporaryPassword: string;
  expiresAt: string;
}) {
  console.log(`\nAdmin "${r.user.username}" (${r.user.role})\n`);
  console.log('Temporary password. It is shown ONCE and stored only as a hash:\n');
  console.log(`  ${r.temporaryPassword}\n`);
  console.log(`Valid until ${r.expiresAt} if unused. At first sign-in they will:`);
  console.log(
    '  1. enter this password,\n  2. scan a QR code with an authenticator app and save the recovery codes,\n  3. choose their own password.',
  );
}

try {
  if (cmd === 'create' && username && (ADMIN_ROLES as readonly string[]).includes(roleArg ?? '')) {
    const parsed = CreateAdminSchema.safeParse({ username, role: roleArg as AdminRole });
    if (!parsed.success) throw new Error('username must be 3-32 characters of a-z 0-9 . _ -');
    printCredentials(await users.create(parsed.data, actor));
  } else if (cmd === 'list') {
    const rows = await users.list();
    if (!rows.length) console.log('no admins yet: create one with `create <username> SUPER_ADMIN`');
    for (const u of rows)
      console.log(
        `${u.username.padEnd(20)} ${u.role.padEnd(12)} ${u.isDisabled ? 'DISABLED ' : 'active   '}${u.mfaEnabled ? 'mfa    ' : 'NO-MFA '}${u.lockedUntil ? `LOCKED until ${u.lockedUntil}` : ''}${u.mustChangePassword ? ' (temporary password)' : ''}`,
      );
  } else if (cmd === 'unlock') {
    await users.unlock(await idOf(username), actor);
    console.log('unlocked');
  } else if (cmd === 'reset') {
    printCredentials(await users.resetCredentials(await idOf(username), actor));
  } else if (cmd === 'disable' || cmd === 'enable') {
    await users.update(await idOf(username), { isDisabled: cmd === 'disable' }, actor);
    console.log(cmd === 'disable' ? 'disabled, and signed out everywhere' : 'enabled');
  } else {
    console.error(
      `usage: admin create <username> <${ADMIN_ROLES.join('|')}> | list | unlock <username> | reset <username> | disable <username> | enable <username>`,
    );
    process.exitCode = 2;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
} finally {
  await pool.end();
}
