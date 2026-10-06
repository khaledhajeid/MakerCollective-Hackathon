import { ApiError } from '../../lib/api';
import type { Dict } from '../../i18n/dict';

/** Maps an API failure to localised copy that says what to do next. Raw server text is never shown. */
export function errorMessage(
  err: unknown,
  d: Dict,
  fmt: (t: string, v: Record<string, string | number>) => string,
): string {
  if (!(err instanceof ApiError)) return d.errors.internal;
  const e = d.errors;
  switch (err.code) {
    case 'NETWORK':
      return e.network;
    case 'UNAUTHENTICATED':
      return e.unauthenticated;
    case 'RATE_LIMITED':
      return err.retryAfterSeconds
        ? fmt(e.rateLimited, { seconds: Math.max(1, Math.ceil(err.retryAfterSeconds)) })
        : e.rateLimitedGeneric;
    case 'PHONE_NOT_ALLOWED':
      return e.phoneNotAllowed;
    case 'SMS_UNAVAILABLE':
      return e.smsUnavailable;
    case 'CONSENT_REQUIRED':
      return e.consentRequired;
    case 'VOTING_NOT_OPEN':
      return e.votingNotOpen;
    case 'EXHIBITOR_NOT_IN_CATEGORY':
      return e.notInCategory;
    case 'VISITOR_BLOCKED':
      return e.visitorBlocked;
    case 'VALIDATION_FAILED':
      return e.validation;
    default:
      return e.internal;
  }
}
