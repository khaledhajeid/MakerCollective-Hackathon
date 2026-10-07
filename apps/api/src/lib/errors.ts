import type { ErrorCode } from '@mc/shared';

/** An expected, client-facing failure. Anything else is treated as a 500 and its message hidden. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * The SQLSTATE of a failed query. Drizzle wraps driver errors ("Failed query: …") and keeps the original on
 * `cause`, so checking only `err.code` silently misses every constraint violation.
 */
export function pgErrorCode(err: unknown): string | undefined {
  for (let e = err as { code?: unknown; cause?: unknown } | undefined, i = 0; e && i < 4; i++) {
    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) return e.code;
    e = e.cause as typeof e;
  }
  return undefined;
}
