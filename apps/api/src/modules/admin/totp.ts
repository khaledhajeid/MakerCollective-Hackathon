import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238) over HMAC-SHA1, 6 digits, 30 s steps: the combination every authenticator app implements.
 * (SHA-1 is safe inside HMAC; moving to SHA-256 would break Google Authenticator and others.)
 */
export const STEP_SEC = 30;
const DIGITS = 6;
/** Accept the previous and next step too: tolerates clock drift between the phone and the server. */
const DRIFT_STEPS = 1;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160 bits, the size RFC 4226 recommends. Returned base32 (what authenticator apps and the QR carry). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin =
    ((mac[offset]! & 0x7f) << 24) |
    (mac[offset + 1]! << 16) |
    (mac[offset + 2]! << 8) |
    mac[offset + 3]!;
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

export const stepAt = (ms: number) => Math.floor(ms / 1000 / STEP_SEC);

/**
 * The time-step a code belongs to, or null. A step at or before `lastStep` is refused: a code that was
 * already accepted (shoulder-surfed, or replayed by a proxy) cannot be used again within its validity.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  nowMs: number,
  lastStep: number | null,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretBase32);
  const now = stepAt(nowMs);
  let matched: number | null = null;
  // Check every candidate (no early exit) so timing does not reveal which step matched.
  for (let step = now - DRIFT_STEPS; step <= now + DRIFT_STEPS; step++) {
    const expected = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(expected, Buffer.from(code)) && (lastStep === null || step > lastStep))
      matched = step;
  }
  return matched;
}

export function otpauthUri(secretBase32: string, account: string, issuer: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const q = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SEC),
  });
  return `otpauth://totp/${label}?${q.toString()}`;
}
