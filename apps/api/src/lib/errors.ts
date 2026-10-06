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
