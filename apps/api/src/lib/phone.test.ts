import { describe, expect, it } from 'vitest';
import { normalizePhone } from './phone.js';

const JO_MOBILE = ['+9627'];

describe('normalizePhone', () => {
  it.each([
    '0791234567',
    '791234567',
    '+962791234567',
    '+962 79 123 4567',
    '00962791234567',
    '(079) 123-4567',
    '٠٧٩١٢٣٤٥٦٧',
    '۰۷۹۱۲۳۴۵۶۷',
    '\u200F+962 79 123 4567',
    '\u202A0791234567\u202C',
    '\u2066٠٧٩ ١٢٣ ٤٥٦٧\u2069',
  ])('normalises %s to the same E.164 identity', (input) => {
    const r = normalizePhone(input, JO_MOBILE);
    expect(r).toMatchObject({ ok: true, e164: '+962791234567' });
  });

  it('masks for display without revealing the full number', () => {
    const r = normalizePhone('0791234567', JO_MOBILE);
    expect(r.ok && r.masked).toBe('+962 7•• ••• 567');
  });

  it('accepts the three Jordanian mobile ranges', () => {
    for (const n of ['0771234567', '0781234567', '0791234567']) {
      expect(normalizePhone(n, JO_MOBILE).ok).toBe(true);
    }
  });

  it('rejects Jordanian landlines', () => {
    expect(normalizePhone('065806162', JO_MOBILE)).toEqual({ ok: false, reason: 'NOT_MOBILE' });
  });

  it('rejects valid foreign mobiles outside the allowed prefixes (SMS pumping control)', () => {
    expect(normalizePhone('+447911123456', JO_MOBILE)).toEqual({
      ok: false,
      reason: 'PREFIX_NOT_ALLOWED',
    });
  });

  it.each(['', 'abc', '123', '07912345678901234', '+962 79 123', 'javascript:alert(1)'])(
    'rejects junk input %j',
    (input) => {
      expect(normalizePhone(input, JO_MOBILE).ok).toBe(false);
    },
  );
});
