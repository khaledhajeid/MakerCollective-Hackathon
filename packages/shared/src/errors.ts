/**
 * Stable, machine-readable error codes returned by the API as `{ error: { code, message } }`.
 * The web client maps these to localised, actionable copy — never show raw server text.
 */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'NOT_ON_VENUE_NETWORK',
  'VOTING_NOT_OPEN',
  'PHONE_NOT_ALLOWED',
  'OTP_INVALID',
  'OTP_EXPIRED',
  'OTP_LOCKED',
  'OTP_RESEND_TOO_SOON',
  'CONSENT_REQUIRED',
  'VISITOR_BLOCKED',
  'SMS_UNAVAILABLE',
  'ALREADY_VOTED',
  'EXHIBITOR_NOT_IN_CATEGORY',
  'CSRF_FAILED',
  'MFA_REQUIRED',
  'PASSWORD_CHANGE_REQUIRED',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}
