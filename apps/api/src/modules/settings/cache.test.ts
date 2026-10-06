import { describe, expect, it } from 'vitest';
import type { Database } from '../../db/client.js';
import { SettingsCache } from './cache.js';

/** A db whose settings read resolves only when the test says so. */
function controllableDb() {
  const pending: ((v: Record<string, unknown>) => void)[] = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => new Promise((resolve) => pending.push((row) => resolve([row]))),
      }),
    }),
  } as unknown as Database;
  return { db, resolveNext: (row: Record<string, unknown>) => pending.shift()!(row), pending };
}

describe('SettingsCache', () => {
  it('coalesces concurrent reads into one query', async () => {
    const { db, resolveNext, pending } = controllableDb();
    const cache = new SettingsCache(db);
    const a = cache.get();
    const b = cache.get();
    expect(pending).toHaveLength(1);
    resolveNext({ v: 1 });
    expect(await a).toEqual(await b);
  });

  it('does not cache a stale snapshot that was already in flight when invalidate() ran', async () => {
    const { db, resolveNext, pending } = controllableDb();
    const cache = new SettingsCache(db);
    const stale = cache.get();
    cache.invalidate(); // admin saved new settings while the old read was in flight
    resolveNext({ v: 'old' });
    await stale;
    const fresh = cache.get();
    expect(pending).toHaveLength(1); // the stale value was NOT cached, so a new read is issued
    resolveNext({ v: 'new' });
    expect(await fresh).toEqual({ v: 'new' });
  });
});
