import { toAsciiDigits } from '@mc/shared';
import { parsePhoneNumberWithError } from 'libphonenumber-js/max';

export type PhoneResult =
  | { ok: true; e164: string; masked: string }
  | { ok: false; reason: 'INVALID' | 'NOT_MOBILE' | 'PREFIX_NOT_ALLOWED' };

/**
 * Normalise any reasonable visitor input to E.164 so that `0791234567`, `+962 79 123 4567`,
 * `00962791234567` and `٠٧٩١٢٣٤٥٦٧` all identify the SAME voter (F12).
 * Only mobile numbers matching an allowed prefix are accepted — this is also the
 * primary SMS-pumping control (OTP never goes to premium/foreign ranges).
 */
export function normalizePhone(input: string, allowedPrefixes: readonly string[]): PhoneResult {
  const cleaned = toAsciiDigits(input)
    // \p{Cf}: invisible bidi/format marks that Arabic keyboards and contact pastes insert.
    .replace(/[\s\p{Cf}\-().]/gu, '')
    .replace(/^00/, '+');
  if (!/^\+?\d{6,16}$/.test(cleaned)) return { ok: false, reason: 'INVALID' };

  let e164: string;
  try {
    const parsed = parsePhoneNumberWithError(cleaned, 'JO');
    if (!parsed.isValid()) return { ok: false, reason: 'INVALID' };
    const type = parsed.getType();
    if (type !== 'MOBILE' && type !== 'FIXED_LINE_OR_MOBILE')
      return { ok: false, reason: 'NOT_MOBILE' };
    e164 = parsed.number;
  } catch {
    return { ok: false, reason: 'INVALID' };
  }

  if (!allowedPrefixes.some((prefix) => e164.startsWith(prefix))) {
    return { ok: false, reason: 'PREFIX_NOT_ALLOWED' };
  }
  return { ok: true, e164, masked: maskPhone(e164) };
}

/** +962791234567 → +962 7•• ••• 567 (admin views and SMS outbox never show full numbers). */
export function maskPhone(e164: string): string {
  const cc = e164.startsWith('+962') ? '+962' : e164.slice(0, e164.length - 9);
  const rest = e164.slice(cc.length);
  return `${cc} ${rest.slice(0, 1)}•• ••• ${rest.slice(-3)}`;
}
