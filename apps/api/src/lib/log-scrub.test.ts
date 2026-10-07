import { describe, expect, it } from 'vitest';
import { scrubError } from './log-scrub.js';

describe('scrubError', () => {
  const pgErr = Object.assign(new Error('duplicate key value violates unique constraint "x"'), {
    code: '23505',
    constraint: 'visitors_phone_hash_key',
    table: 'visitors',
    detail: 'Key (phone_hash)=(deadbeefcafe) already exists.',
    where: 'secret context',
  });
  const wrapped = new Error(
    'Failed query: select "id" from "admin_sessions" where "token_hash" = $1\nparams: s3cr3t-token-hash',
    { cause: pgErr },
  );

  it('drops bound parameters from the message and the stack', () => {
    const out = scrubError(wrapped) as { message: string; stack: string };
    expect(out.message).toContain('Failed query: select');
    expect(out.message).not.toContain('s3cr3t');
    expect(out.stack).not.toContain('s3cr3t');
    expect(out.stack).toContain('    at ');
  });

  it('keeps the SQL state and constraint but drops the row values in `detail`', () => {
    const out = scrubError(wrapped) as unknown as { cause: Record<string, unknown> };
    expect(out.cause.code).toBe('23505');
    expect(out.cause.constraint).toBe('visitors_phone_hash_key');
    expect(JSON.stringify(out)).not.toContain('deadbeefcafe');
    expect(JSON.stringify(out)).not.toContain('secret context');
  });

  it('hides the value PostgreSQL quotes in its own message, keeps constraint names', () => {
    const e = Object.assign(new Error('invalid input syntax for type inet: "10.0.0.secret"'), {
      severity: 'ERROR',
      code: '22P02',
    });
    const dup = Object.assign(
      new Error('duplicate key value violates unique constraint "visitors_pkey"'),
      {
        severity: 'ERROR',
      },
    );
    expect(JSON.stringify(scrubError(e))).not.toContain('secret');
    expect(scrubError(dup).message).toContain('"visitors_pkey"');
  });

  it('keeps the members of an AggregateError and cuts parameters from string messages', () => {
    const agg = new AggregateError([new Error('a'), new Error('b')], 'both failed');
    expect((scrubError(agg).errors as unknown[]).length).toBe(2);
    expect(scrubError('Error: Failed query: select 1\nparams: tok3n').message).not.toContain(
      'tok3n',
    );
  });

  it('survives non-errors and cyclic causes', () => {
    expect(scrubError('boom').message).toBe('boom');
    expect(scrubError({ a: 1 }).message).toBe('[non-error value]');
    const a = new Error('a');
    (a as Error & { cause?: unknown }).cause = a;
    expect(() => JSON.stringify(scrubError(a))).not.toThrow();
  });
});
