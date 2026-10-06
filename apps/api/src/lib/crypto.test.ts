import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FieldCipher, hmacHex, safeEqual } from './crypto.js';

const cipher = new FieldCipher(randomBytes(32).toString('base64'));

describe('FieldCipher (AES-256-GCM)', () => {
  it('round-trips UTF-8 including Arabic', () => {
    const ct = cipher.encrypt('خالد Khaled', 'visitor.name');
    expect(ct).toMatch(/^v1\./);
    expect(cipher.decrypt(ct, 'visitor.name')).toBe('خالد Khaled');
  });

  it('uses a fresh IV: same plaintext never yields the same ciphertext', () => {
    expect(cipher.encrypt('+962791234567', 'visitor.phone')).not.toBe(
      cipher.encrypt('+962791234567', 'visitor.phone'),
    );
  });

  it('rejects a ciphertext moved to another column (AAD purpose binding)', () => {
    const ct = cipher.encrypt('+962791234567', 'visitor.phone');
    expect(() => cipher.decrypt(ct, 'visitor.name')).toThrow();
  });

  it('rejects tampering (auth tag)', () => {
    const ct = cipher.encrypt('secret', 'visitor.name');
    const raw = Buffer.from(ct.slice(3), 'base64url');
    raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) ^ 0x01;
    expect(() => cipher.decrypt(`v1.${raw.toString('base64url')}`, 'visitor.name')).toThrow();
  });

  it('rejects a different key', () => {
    const other = new FieldCipher(randomBytes(32).toString('base64'));
    expect(() => other.decrypt(cipher.encrypt('x', 'visitor.name'), 'visitor.name')).toThrow();
  });

  it('refuses keys that are not 32 bytes', () => {
    expect(() => new FieldCipher(randomBytes(16).toString('base64'))).toThrow();
  });
});

describe('hashing helpers', () => {
  it('hmacHex is deterministic per key and differs across keys', () => {
    expect(hmacHex('k1', 'v')).toBe(hmacHex('k1', 'v'));
    expect(hmacHex('k1', 'v')).not.toBe(hmacHex('k2', 'v'));
    expect(hmacHex('k1', 'v')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('safeEqual compares exactly', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
