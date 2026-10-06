# ADR-004: SMS provider strategy (no paid vendor for the prototype)

- **Status:** Accepted, 2026-10-06

## Context
- OTP verification is mandatory (F6).
- No free SMS service reliably delivers to Jordanian numbers.
- CPF will select and provision its own SMS gateway before the live pilot (challenge §6).

## Decision
One `SmsProvider` interface with three adapters, selected by configuration (`SMS_PROVIDER`):
1. **`console`:** development and tests. The OTP is written to the server log. In production it needs the explicit opt-in `DEMO_MODE=true`.
2. **`demo-inbox`:** pitch demo. Outgoing messages are stored in `sms_outbox` (masked number, message body) and shown on an **admin-only live "SMS inbox" page** that the presenter puts on screen. Every other control (rate limits, TTL, attempt lock-out, hashing) runs exactly as in production. The admin UI shows a permanent "DEMO SMS MODE" banner.
3. **`http`:** CPF's gateway. A generic HTTPS adapter configured entirely by env (endpoint URL, auth header, JSON body template with `{to}`/`{message}` placeholders, timeout), so CPF connects its own service **without code changes**.

The OTP code is always generated, hashed and verified **by us**, never by the vendor, so the security properties don't depend on which gateway is plugged in.

## Consequences
- A real-SMS demo isn't required for the pitch; the handover story ("plug your gateway into one config block") is a strength.
- `demo-inbox` and `console` expose OTPs and must never run at the real event. The pitch demo runs the production image, so the guard is an **explicit opt-in** rather than "refused in production": with `NODE_ENV=production` the API refuses to boot with either adapter unless `DEMO_MODE=true` (tested), and every boot with a non-`http` adapter logs a loud warning. The real event uses `SMS_PROVIDER=http` and no `DEMO_MODE`; the Phase 7 pre-event checklist verifies it.
- `http` template placeholders (`{to}`, `{message}`) are substituted into JSON string **values** only, so message text can never alter the request structure. Redirects are refused, the URL must be `https` in production, and the request has a hard timeout. A non-2xx answer rolls the OTP challenge back so the visitor can retry immediately.
- Twilio was dropped as a first-class option (2026-10-06 decision); a Twilio account can still be used through the `http` adapter.
