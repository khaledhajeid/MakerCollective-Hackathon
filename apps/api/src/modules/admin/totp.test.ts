import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hotp,
  otpauthUri,
  stepAt,
  verifyTotp,
} from './totp.js';

// RFC 6238 Appendix B, SHA-1 seed "12345678901234567890". The RFC lists 8-digit codes; ours are the last 6.
const SEED = Buffer.from('12345678901234567890');
const SEED_B32 = base32Encode(SEED);
const VECTORS: Array<[number, string]> = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
  [20000000000, '353130'],
];

describe('totp', () => {
  it.each(VECTORS)('matches the RFC 6238 vector at t=%i', (t, code) => {
    expect(hotp(SEED, stepAt(t * 1000))).toBe(code);
  });

  it('round-trips base32 and rejects junk', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('mzxw 6ytb-oi').toString()).toBe('foobar');
    expect(() => base32Decode('MZXW1')).toThrow();
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(s))).toBe(s);
  });

  it('accepts the current step and one step of drift, no more', () => {
    const t = 1111111109 * 1000;
    const step = stepAt(t);
    expect(verifyTotp(SEED_B32, hotp(SEED, step), t, null)).toBe(step);
    expect(verifyTotp(SEED_B32, hotp(SEED, step - 1), t, null)).toBe(step - 1);
    expect(verifyTotp(SEED_B32, hotp(SEED, step + 1), t, null)).toBe(step + 1);
    expect(verifyTotp(SEED_B32, hotp(SEED, step - 2), t, null)).toBeNull();
    expect(verifyTotp(SEED_B32, hotp(SEED, step + 2), t, null)).toBeNull();
  });

  it('refuses a step that was already used (replay) but accepts a later one', () => {
    const t = 1111111109 * 1000;
    const step = stepAt(t);
    expect(verifyTotp(SEED_B32, hotp(SEED, step), t, step)).toBeNull();
    expect(verifyTotp(SEED_B32, hotp(SEED, step - 1), t, step)).toBeNull();
    expect(verifyTotp(SEED_B32, hotp(SEED, step + 1), t, step)).toBe(step + 1);
  });

  it('rejects malformed codes without touching the secret', () => {
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 456', '١٢٣٤٥٦'])
      expect(verifyTotp(SEED_B32, bad, 1e12, null)).toBeNull();
  });

  it('builds an otpauth URI authenticator apps accept', () => {
    const uri = new URL(otpauthUri('JBSWY3DPEHPK3PXP', 'khaled.h', 'MC 2026'));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.host).toBe('totp');
    expect(uri.pathname).toBe('/MC%202026:khaled.h');
    expect(uri.searchParams.get('secret')).toBe('JBSWY3DPEHPK3PXP');
    expect(uri.searchParams.get('issuer')).toBe('MC 2026');
    expect(uri.searchParams.get('digits')).toBe('6');
    expect(uri.searchParams.get('period')).toBe('30');
  });
});
