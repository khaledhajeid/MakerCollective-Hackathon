import { Redis } from 'ioredis';

/**
 * Redis is an accelerator, not a dependency: commands fail fast while it is
 * down (no offline queue) so callers can fall back instead of hanging.
 */
export function createRedis(url: string | undefined): Redis | null {
  if (!url) return null;
  return new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
  });
}
