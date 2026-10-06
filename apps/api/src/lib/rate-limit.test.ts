import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limit.js';

describe('RateLimiter (per-process fallback)', () => {
  it('allows up to the limit, then blocks until the window resets', async () => {
    let t = 1_000_000;
    const rl = new RateLimiter(null, undefined, () => t);
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await rl.hit('b', 'k', 3, 60)).allowed);
    expect(results).toEqual([true, true, true, false]);
    expect((await rl.hit('b', 'k', 3, 60)).retryAfterSec).toBe(60);
    t += 61_000;
    expect((await rl.hit('b', 'k', 3, 60)).allowed).toBe(true);
  });

  it('keeps buckets and keys independent', async () => {
    const rl = new RateLimiter(null);
    await rl.hit('a', 'k', 1, 60);
    expect((await rl.hit('a', 'k', 1, 60)).allowed).toBe(false);
    expect((await rl.hit('a', 'other', 1, 60)).allowed).toBe(true);
    expect((await rl.hit('b', 'k', 1, 60)).allowed).toBe(true);
  });

  it('falls back to local counters when Redis errors, and reports it', async () => {
    let reported = 0;
    const broken = {
      eval: async () => {
        throw new Error('ECONNREFUSED');
      },
    } as never;
    const rl = new RateLimiter(broken, () => reported++);
    expect((await rl.hit('b', 'k', 1, 60)).allowed).toBe(true);
    expect((await rl.hit('b', 'k', 1, 60)).allowed).toBe(false);
    expect(reported).toBe(2);
  });

  it('uses the shared Redis counter when available', async () => {
    const calls: unknown[][] = [];
    const redis = { eval: async (...a: unknown[]) => (calls.push(a), [4, 30_000]) } as never;
    const r = await new RateLimiter(redis).hit('otp', 'phone-hash', 3, 60);
    expect(r).toEqual({ allowed: false, retryAfterSec: 30 });
    expect(calls[0]![2]).toBe('rl:otp:phone-hash');
  });
});
