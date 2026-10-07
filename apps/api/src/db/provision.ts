import type pg from 'pg';

/**
 * Least-privilege database role for the API (ADR-009, closes R-6).
 *
 * The API used to connect as the database owner/superuser, so one SQL-injection bug (none known; every query is
 * parameterised) could have switched off the vote and audit-log triggers. Now the migrate step (owner) builds the
 * schema and then provisions `mc_app`: no superuser, no DDL, no TRIGGER, no TRUNCATE, and UPDATE/DELETE only on the
 * tables the application really changes. The grants are an explicit allow-list, rebuilt from scratch on every
 * start, so a table added later is invisible to the API until it is listed here (fail closed).
 */
export const APP_ROLE = 'mc_app';

/** Tables the API may UPDATE. `votes` and `audit_log` are deliberately absent: append-only. */
const MAY_UPDATE = [
  'admin_recovery_codes',
  'admin_sessions',
  'admin_users',
  'categories',
  'display_tokens',
  'exhibitors',
  'otp_challenges',
  'settings',
  'visitors',
];
/** Tables the API may DELETE from. Votes, visitors, settings and the audit log can never be deleted by it. */
const MAY_DELETE = [
  'admin_recovery_codes',
  'admin_sessions',
  'categories',
  'exhibitor_categories',
  'exhibitor_photos',
  'exhibitors',
  'otp_challenges',
];

export async function provisionAppRole(
  pool: pg.Pool,
  password: string,
  role: string = APP_ROLE,
): Promise<void> {
  if (!/^[a-z_][a-z0-9_]{1,30}$/.test(role)) throw new Error('invalid role name');
  if (password.length < 24) throw new Error('APP_DB_PASSWORD must be at least 24 characters');

  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    // Serialise concurrent starts (two migrate runs); the lock is released at COMMIT.
    await c.query('SELECT pg_advisory_xact_lock(7770001)');
    const exists = (await c.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])).rowCount;
    const { rows } = await c.query<{ stmt: string }>(
      `SELECT format('%s ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 60', $1::text, $2::text, $3::text) AS stmt`,
      [exists ? 'ALTER' : 'CREATE', role, password],
    );
    await c.query(rows[0]!.stmt);
    const r = role; // validated above, safe to interpolate as an identifier
    const grant = await c.query<{ stmt: string }>(
      `SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), $1::text) AS stmt`,
      [r],
    );
    await c.query(grant.rows[0]!.stmt);
    await c.query(`ALTER ROLE ${r} SET idle_in_transaction_session_timeout = '30s'`);
    // Reset everything the role could hold, then grant only the allow-list. CREATE on the schema is removed from
    // everyone (it is already absent on a fresh PostgreSQL 15+, but a database upgraded from an older version
    // keeps the old default that lets any role create objects).
    await c.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await c.query(`REVOKE ALL ON SCHEMA public FROM ${r}`);
    await c.query(`GRANT USAGE ON SCHEMA public TO ${r}`);
    await c.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${r}`);
    await c.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${r}`);
    await c.query(`GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO ${r}`);
    for (const t of MAY_UPDATE) await c.query(`GRANT UPDATE ON public.${t} TO ${r}`);
    for (const t of MAY_DELETE) await c.query(`GRANT DELETE ON public.${t} TO ${r}`);
    await c.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${r}`);
    await c.query('COMMIT');
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

/**
 * True when the connection's role could bypass the triggers or rebuild the schema: superuser, role/database
 * creation, replication, RLS bypass, being (or being a member of) the table owner, or holding one of PostgreSQL's
 * predefined all-data / server-file / server-program roles.
 */
export async function connectedAsPrivilegedRole(pool: pg.Pool): Promise<boolean> {
  const { rows } = await pool.query<{ priv: boolean }>(
    `SELECT (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls
             OR pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = 'public.votes'::regclass), 'USAGE')
             OR pg_has_role(current_user, 'pg_write_all_data', 'USAGE')
             OR pg_has_role(current_user, 'pg_read_all_data', 'USAGE')
             OR pg_has_role(current_user, 'pg_execute_server_program', 'USAGE')
             OR pg_has_role(current_user, 'pg_read_server_files', 'USAGE')
             OR pg_has_role(current_user, 'pg_write_server_files', 'USAGE')) AS priv
       FROM pg_roles r WHERE r.rolname = current_user`,
  );
  return rows[0]?.priv ?? true;
}
