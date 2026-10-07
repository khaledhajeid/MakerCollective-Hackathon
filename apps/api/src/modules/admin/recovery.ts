import { randomInt } from 'node:crypto';
import { hmacHex } from '../../lib/crypto.js';

/**
 * Recovery codes: the way back in when the phone is lost. 60 random bits each (Crockford base32, no look-alike
 * letters), shown once, stored only as a keyed hash, single use. 60 bits plus the sign-in lock-out make guessing
 * pointless; the key means a leaked database cannot be used to confirm candidate codes offline.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const RECOVERY_CODE_COUNT = 10;
const LENGTH = 12;

export function generateRecoveryCode(): string {
  let raw = '';
  for (let i = 0; i < LENGTH; i++) raw += ALPHABET[randomInt(ALPHABET.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

/** Forgiving about how a human types it (case, dashes, spaces, O/0 and I/L/1), strict about the result. */
export function normalizeRecoveryCode(input: string): string | null {
  const clean = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return clean.length === LENGTH && [...clean].every((c) => ALPHABET.includes(c)) ? clean : null;
}

export const hashRecoveryCode = (key: string, normalized: string): string =>
  hmacHex(`${key}:admin-recovery`, normalized);
