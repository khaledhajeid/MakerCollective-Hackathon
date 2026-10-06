/**
 * Stable, machine-readable error codes returned by the API as `{ error: { code, message } }`.
 * The web client maps these to localised, actionable copy — never show raw server text.
 */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'RATE_LIMITED',
  'NOT_ON_VENUE_NETWORK',
  'VOTING_NOT_OPEN',
  'PHONE_NOT_ALLOWED',
  'OTP_INVALID',
  'OTP_EXPIRED',
  'OTP_LOCKED',
  'OTP_RESEND_TOO_SOON',
  'ALREADY_VOTED',
  'EXHIBITOR_NOT_IN_CATEGORY',
  'CSRF_FAILED',
  'MFA_REQUIRED',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}
