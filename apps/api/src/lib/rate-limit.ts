import type { Redis } from 'ioredis';

export interface LimitResult {
  allowed: boolean;
  /** Seconds until the window resets (for Retry-After). */
  retryAfterSec: number;
}

// Atomic fixed-window counter: INCR, and start the expiry only when the key is created.
const SCRIPT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {c, redis.call('PTTL', KEYS[1])}
`;

const MAX_LOCAL_KEYS = 50_000;

/**
 * Fixed-window rate limiter shared across API replicas through Redis. When Redis is absent or down it
 * falls back to a per-process counter: limits then apply per replica (≈ N× looser) instead of the API
 * failing closed or hanging. Authoritative one-shot rules (OTP cooldown, attempt lock-out, one vote per
 * category) live in Postgres, so a Redis outage never weakens the integrity guarantees.
 */
export class RateLimiter {
  private readonly local = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly redis: Redis | null,
    private readonly onFallback: (err: unknown) => void = () => undefined,
    private readonly now: () => number = Date.now,
  ) {}

  async hit(bucket: string, key: string, limit: number, windowSec: number): Promise<LimitResult> {
    const k = `rl:${bucket}:${key}`;
    if (this.redis) {
      try {
        const [count, pttl] = (await this.redis.eval(SCRIPT, 1, k, windowSec * 1000)) as [
          number,
          number,
        ];
        return { allowed: count <= limit, retryAfterSec: Math.max(1, Math.ceil(pttl / 1000)) };
      } catch (err) {
        this.onFallback(err);
      }
    }
    return this.hitLocal(k, limit, windowSec);
  }

  private hitLocal(k: string, limit: number, windowSec: number): LimitResult {
    const t = this.now();
    let entry = this.local.get(k);
    if (!entry || entry.resetAt <= t) {
      if (this.local.size >= MAX_LOCAL_KEYS) this.sweep(t);
      entry = { count: 0, resetAt: t + windowSec * 1000 };
      this.local.set(k, entry);
    }
    entry.count += 1;
    return {
      allowed: entry.count <= limit,
      retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - t) / 1000)),
    };
  }

  private sweep(t: number): void {
    for (const [k, v] of this.local) if (v.resetAt <= t) this.local.delete(k);
    // Still full of live keys (flood): drop the oldest half rather than grow without bound.
    if (this.local.size >= MAX_LOCAL_KEYS) {
      let i = 0;
      for (const k of this.local.keys()) {
        if (i++ > MAX_LOCAL_KEYS / 2) break;
        this.local.delete(k);
      }
    }
  }
}
