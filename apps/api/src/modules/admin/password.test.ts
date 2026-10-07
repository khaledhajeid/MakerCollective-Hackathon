import { describe, expect, it } from 'vitest';
import {
  checkPassword,
  dummyHash,
  gated,
  generatePassword,
  hashPassword,
  needsRehash,
  verifyPassword,
} from './password.js';

describe('password hashing', () => {
  it('produces a PHC argon2id string, salted, that verifies', async () => {
    const a = await hashPassword('correct horse battery');
    const b = await hashPassword('correct horse battery');
    expect(a).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword('correct horse battery', a)).toBe(true);
    expect(await verifyPassword('correct horse batterz', a)).toBe(false);
    expect(await verifyPassword('', a)).toBe(false);
  });

  it('treats canonically equivalent Unicode as the same password (NFKC)', async () => {
    const h = await hashPassword('Ｃａｆé-passphrase-1');
    expect(await verifyPassword('Café-passphrase-1', h)).toBe(true);
  });

  it('fails closed on a malformed or dangerous stored hash instead of throwing', async () => {
    for (const bad of [
      '',
      'plaintext',
      '$argon2i$v=19$m=65536,t=3,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA',
      '$argon2id$v=19$m=99999999,t=3,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA',
      '$argon2id$v=19$m=65536,t=999,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA',
    ])
      expect(await verifyPassword('anything at all', bad)).toBe(false);
  });

  it('flags hashes made with older cost parameters for upgrade', async () => {
    expect(needsRehash(await hashPassword('some long enough one'))).toBe(false);
    expect(needsRehash('$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA')).toBe(
      true,
    );
    expect(needsRehash('garbage')).toBe(true);
  });

  it('keeps a usable dummy hash for unknown accounts', async () => {
    const d = await dummyHash();
    expect(d).toMatch(/^\$argon2id\$/);
    expect(await dummyHash()).toBe(d);
    expect(await verifyPassword('guess', d)).toBe(false);
  });
});

describe('password policy', () => {
  const ctx = { username: 'khaled.h' };
  it('enforces length by characters, not bytes', () => {
    expect(checkPassword('short-one', ctx)).toBe('too_short');
    expect(checkPassword('x'.repeat(129), ctx)).toBe('too_long');
    expect(checkPassword('كلمةسرمطولةجدا١٢٣', ctx)).toBeNull();
  });
  it('rejects what attackers try first', () => {
    expect(checkPassword('aaaaaaaaaaaaaaaa', ctx)).toBe('repeated');
    expect(checkPassword('abababababab', ctx)).toBe('repeated');
    expect(checkPassword('Password123456!', ctx)).toBe('common');
    expect(checkPassword('p-a-s-s-w-o-r-d-1-2-3', ctx)).toBe('common');
    expect(checkPassword('MakerCollective2026', ctx)).toBe('common');
    expect(checkPassword('my-KHALED.H-secret-1', ctx)).toBe('contains_username');
  });
  it('refuses to keep the same password', () => {
    expect(
      checkPassword('a-fine-long-passphrase', { ...ctx, sameAs: 'a-fine-long-passphrase' }),
    ).toBe('same_as_current');
    expect(checkPassword('a-fine-long-passphrase', ctx)).toBeNull();
  });
  it('generates strong temporary passwords without look-alike characters', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const p = generatePassword();
      expect(p).toMatch(/^[a-km-zA-HJ-NP-Z2-9]{20}$/);
      expect(checkPassword(p, ctx)).toBeNull();
      seen.add(p);
    }
    expect(seen.size).toBe(50);
  });
});

describe('the hashing gate', () => {
  it('never lets more than two hashes run at once, however the callers arrive', async () => {
    let active = 0;
    let peak = 0;
    const job = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    };
    // A wave, then stragglers arriving while earlier jobs finish. Every call is collected and awaited, so nothing
    // is still in flight when the next test starts.
    const calls: Array<Promise<void>> = Array.from({ length: 12 }, () => gated(job));
    for (let i = 0; i < 20; i++)
      calls.push(
        new Promise<void>((resolve) => setTimeout(() => void gated(job).then(resolve), i)),
      );
    await Promise.all(calls);
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBe(2);
  });

  it('does not exceed the cap when a caller arrives in the very instant a slot is released', async () => {
    // The interleaving that broke the first version: A finishes, its slot is freed and handed to a waiter, and a
    // brand-new caller is already queued to run in the microtask between the two.
    let active = 0;
    let peak = 0;
    const latch = () => {
      let release!: () => void;
      const done = new Promise<void>((r) => (release = r));
      return { done, release };
    };
    const job = (until: Promise<void>) => async () => {
      active++;
      peak = Math.max(peak, active);
      await until;
      active--;
    };
    const [a, b, w, n] = [latch(), latch(), latch(), latch()];
    let aPromise!: Promise<void>;
    const first = gated(() => (aPromise = job(a.done)()));
    const second = gated(job(b.done));
    const waiter = gated(job(w.done)); // the third caller has to queue
    const late = aPromise.then(() => gated(job(n.done))); // runs right after A's slot is released
    a.release();
    await new Promise((r) => setTimeout(r, 10)); // let everything that can start, start
    b.release();
    w.release();
    n.release();
    await Promise.all([first, second, waiter, late]);
    expect(peak).toBe(2);
  });

  it('keeps working after a job throws', async () => {
    await expect(gated(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(gated(async () => 'fine')).resolves.toBe('fine');
  });
});
