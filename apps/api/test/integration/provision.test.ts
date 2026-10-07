import { afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { openTestDb } from './db.js';
import { TEST_APP_ROLE, testDatabaseUrl } from './global-setup.js';
import { connectedAsPrivilegedRole, provisionAppRole } from '../../src/db/provision.js';

const { pool: appPool, owner, reset } = openTestDb();
afterAll(() => appPool.end());

/** What a SQL-injection bug (or a stolen DATABASE_URL) could do as the API's own database user. */
async function denied(sql: string): Promise<string> {
  try {
    await appPool.query(sql);
  } catch (e) {
    return (e as { code?: string }).code ?? 'ERR';
  }
  return 'ALLOWED';
}

describe('least-privilege application role (ADR-009)', () => {
  it('is not a superuser and not the owner', async () => {
    expect(await connectedAsPrivilegedRole(appPool)).toBe(false);
    expect(await connectedAsPrivilegedRole(owner)).toBe(true);
    const { rows } = await appPool.query('select current_user u');
    expect(rows[0].u).toBe(TEST_APP_ROLE);
  });

  it('cannot change the schema, switch the triggers off or empty a table (42501 = insufficient privilege)', async () => {
    await reset();
    expect(await denied('ALTER TABLE votes DISABLE TRIGGER ALL')).toBe('42501');
    expect(await denied('DROP TRIGGER votes_guard ON votes')).toBe('42501');
    expect(await denied('TRUNCATE votes')).toBe('42501');
    expect(await denied('TRUNCATE audit_log')).toBe('42501');
    expect(await denied('DROP TABLE audit_log')).toBe('42501');
    expect(await denied('CREATE TABLE evil (x int)')).toBe('42501');
    expect(await denied("SET session_replication_role = 'replica'")).toBe('42501');
    expect(await denied('CREATE ROLE evil SUPERUSER')).toBe('42501');
    expect(await denied("COPY (select 1) TO PROGRAM 'id'")).toBe('42501');
  });

  it('cannot rewrite or delete votes, the audit log, visitors or settings', async () => {
    await reset();
    for (const sql of [
      'UPDATE votes SET exhibitor_id = exhibitor_id',
      'DELETE FROM votes',
      'UPDATE audit_log SET action = action',
      'DELETE FROM audit_log',
      'DELETE FROM visitors',
      'DELETE FROM settings',
      'DELETE FROM display_tokens',
      'UPDATE sms_outbox SET body = body',
    ])
      expect(await denied(sql), sql).toBe('42501');
  });

  it('can still do the day-to-day work', async () => {
    await reset();
    await appPool.query('select pg_notify($1, $2)', ['results', '{}']);
    await appPool.query('UPDATE settings SET voting_status = voting_status');
    await appPool.query('SELECT count(*) FROM votes');
    expect(await denied('UPDATE settings SET voting_status = voting_status')).toBe('ALLOWED');
  });

  it('is rebuilt from scratch on every run: a stale broad grant is removed, the password rotates', async () => {
    const admin = new pg.Pool({ connectionString: testDatabaseUrl(), max: 1 });
    try {
      await admin.query(`GRANT DELETE ON votes TO ${TEST_APP_ROLE}`);
      await provisionAppRole(admin, `rotated-${'x'.repeat(30)}`, TEST_APP_ROLE);
      expect(await denied('DELETE FROM votes')).toBe('42501');
      // the old suite password no longer works, so tests below would fail if this leaked into the shared role
      await provisionAppRole(
        admin,
        process.env.TEST_APP_DATABASE_URL!.split(':')[2]!.split('@')[0]!,
        TEST_APP_ROLE,
      );
    } finally {
      await admin.end();
    }
  });

  it('refuses a weak password and a bad role name', async () => {
    await expect(provisionAppRole(owner, 'short')).rejects.toThrow(/24 characters/);
    await expect(provisionAppRole(owner, 'x'.repeat(30), 'Robert"; DROP')).rejects.toThrow(
      /role name/,
    );
  });
});
