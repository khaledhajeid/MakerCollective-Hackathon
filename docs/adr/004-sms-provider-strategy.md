# ADR-004: SMS provider strategy (no paid vendor for the prototype)

- **Status:** Accepted, 2026-10-06

## Context
- OTP verification is mandatory (F6).
- No free SMS service reliably delivers to Jordanian numbers.
- CPF will select and provision its own SMS gateway before the live pilot (challenge §6).

## Decision
One `SmsProvider` interface with three adapters, selected by configuration (`SMS_PROVIDER`):
1. **`console`:** development and tests. The OTP is written to the server log, and the adapter is refused in production.
2. **`demo-inbox`:** pitch demo. Outgoing messages are stored in `sms_outbox` (masked number, message body) and shown on an **admin-only live "SMS inbox" page** that the presenter puts on screen. Every other control (rate limits, TTL, attempt lock-out, hashing) runs exactly as in production. The admin UI shows a permanent "DEMO SMS MODE" banner.
3. **`http`:** CPF's gateway. A generic HTTPS adapter configured entirely by env (endpoint URL, auth header, JSON body template with `{to}`/`{message}` placeholders, timeout), so CPF connects its own service **without code changes**.

The OTP code is always generated, hashed and verified **by us**, never by the vendor, so the security properties don't depend on which gateway is plugged in.

## Consequences
- A real-SMS demo isn't required for the pitch; the handover story ("plug your gateway into one config block") is a strength.
- `demo-inbox` must never be enabled at the real event. It is refused when `NODE_ENV=production`, and the Phase 7 pre-event checklist verifies it.
