import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Field-level encryption for PII (F14 / PDPL). AES-256-GCM with a random 96-bit IV per value
 * and an AAD "purpose" label, so a ciphertext copied into another column fails to decrypt.
 * Envelope: `v1.<base64url(iv | tag | ciphertext)>` — the version prefix allows key rotation.
 */
const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type FieldPurpose = 'visitor.name' | 'visitor.phone' | 'admin.totp';

export class FieldCipher {
  readonly #key: Buffer;

  constructor(keyBase64: string) {
    const key = Buffer.from(keyBase64, 'base64');
    if (key.length !== 32) throw new Error('PII key must be 32 bytes');
    this.#key = key;
  }

  encrypt(plaintext: string, purpose: FieldPurpose): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(purpose));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return `${VERSION}.${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url')}`;
  }

  decrypt(envelope: string, purpose: FieldPurpose): string {
    const [version, payload] = envelope.split('.', 2);
    if (version !== VERSION || !payload) throw new Error('unsupported ciphertext envelope');
    const raw = Buffer.from(payload, 'base64url');
    if (raw.length < IV_BYTES + TAG_BYTES) throw new Error('malformed ciphertext');
    const decipher = createDecipheriv('aes-256-gcm', this.#key, raw.subarray(0, IV_BYTES), {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(Buffer.from(purpose));
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    return Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8');
  }
}

/** Keyed, deterministic hash — used for UNIQUE lookups on secrets we must not store in clear. */
export function hmacHex(key: string, value: string): string {
  return createHmac('sha256', key).update(value).digest('hex');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** URL-safe random token with `bytes` of entropy (default 256 bits). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Constant-time comparison of two hex/base64 strings (length leak only). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
