/**
 * ADR-004: the OTP code is generated, hashed and verified by us; an SMS provider only carries text.
 * Swapping the gateway therefore never changes the security properties.
 */
export interface SmsProvider {
  readonly name: 'console' | 'demo-inbox' | 'http';
  /** Throws on delivery failure so the caller can roll the challenge back. */
  send(msg: { toE164: string; toMasked: string; text: string }): Promise<void>;
}
