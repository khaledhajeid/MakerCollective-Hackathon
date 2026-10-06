# Threat model (STRIDE), living document

Updated at the end of every phase. Residual risks are accepted only through an ADR.

## System overview
- **Assets:**
  - Vote integrity (correct counts, one vote per category per person).
  - Visitor PII (name and phone).
  - Admin accounts.
  - The Blind Hour secrecy of standings.
  - SMS budget.
- **Actors:**
  - Visitor (on venue Wi-Fi).
  - Remote attacker (internet).
  - Malicious visitor on the venue network.
  - Admin.
  - TV display.
- **Trust boundaries:**
  1. Internet → tunnel (Cloudflare/ngrok, TLS).
  2. Tunnel → Caddy (trusted only from fixed connector IPs).
  3. Caddy → API replicas (trusted only from 172.28.0.10).
  4. API → Postgres/Redis (Docker network; host ports bound to loopback).
  5. API → SMS provider (outbound HTTPS).

## Phase 0: Foundation

| STRIDE | Threat | Mitigation | Test / evidence | Residual |
|---|---|---|---|---|
| Spoofing | Client forges `X-Forwarded-For` / `CF-Connecting-IP` to look like the venue IP | Caddy trusts client-IP headers only from tunnel connector IPs and overwrites XFF; Fastify `trustProxy` = Caddy IP only | Unit test (untrusted peer XFF ignored); live stack test: forged 6.6.6.6/7.7.7.7 resolved to the real peer | Low |
| Spoofing | Client-supplied request id used to poison log correlation | `requestIdHeader: false`, server-generated UUIDs | Unit test | None |
| Tampering | Dependency or CI supply-chain attack | Exact pins; frozen lockfile in CI; pnpm `minimumReleaseAge` (3 d), `trustPolicy: no-downgrade`, `blockExoticSubdeps`; install scripts allow-listed (`allowBuilds`); GitHub Actions pinned to commit SHAs; `pnpm audit`, Semgrep, gitleaks in CI | Phase 0 review S-1…S-6 | Low |
| Info disclosure | Secrets leaked via repo or logs | `.env` gitignored and generated with mode 600; env errors print keys only; pino redaction (cookies, auth, phone, code, password, name); query strings dropped from logs | Unit test (env error), config | Low |
| Info disclosure | Stack traces or internals in API errors | Uniform error envelope; unknown errors → generic 500, details only in server logs | Unit test | None |
| Info disclosure | Database/Redis reachable from the venue LAN | Compose binds them to `127.0.0.1` only; no API ports published (only via Caddy) | compose config | None |
| DoS | Large bodies | 64 KB body limit (uploads get a dedicated limit in Phase 6); 10 s statement timeout; pool cap | config | Medium: rate limits arrive in Phase 2 |
| DoS | One replica crashes | 2 replicas, Caddy active health checks + retries | Chaos: kill api1 under load → 60/60 OK | Low (laptop = demo SPOF, accepted for the pitch) |
| Elevation | Container breakout impact | API runs as the non-root `node` user; minimal Alpine image | Dockerfile | Low |
| (clickjacking, XSS) | SPA framed or script injected | CSP `script-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'none'`; API CSP `default-src 'none'` | Live header check | Low (`style-src 'unsafe-inline'` kept for animation inline styles) |

## Phase 1: Domain & data

| STRIDE | Threat | Mitigation | Test / evidence | Residual |
|---|---|---|---|---|
| Spoofing | **Forged `CF-Connecting-IP` through the ngrok tunnel bypasses the venue allow-list** (S-7, High) | Caddy reads only `X-Forwarded-For`, strict right-to-left, from the ngrok agent IP only; Cloudflare path removed | `infra/tests/ip-spoof.sh`: 4 forged headers + pre-filled XFF → real IP resolved | Low |
| Tampering | Double voting via races or retries across replicas | `UNIQUE(visitor_id, category_id)` in Postgres | 20 parallel inserts → exactly 1 vote | None |
| Tampering | Vote for an exhibitor outside the category | Composite FK `(exhibitor_id, category_id) → exhibitor_categories` | Integration test | None |
| Tampering | Changing or deleting cast votes (incl. by a buggy admin feature) | Trigger blocks UPDATE always; DELETE/TRUNCATE only with transaction-scoped `mc.allow_vote_reset` | Integration tests (incl. flag does not leak) | Low: a DB superuser can still bypass triggers (R-6) |
| Repudiation | Admin actions denied after the fact | `audit_log` append-only (UPDATE/DELETE/TRUNCATE blocked) | Integration test | Low (same superuser caveat) |
| Spoofing | One person, many identities via number formatting (`079…`, `+962…`, `٠٧٩…`) | E.164 normalisation incl. Arabic-Indic digits → HMAC → UNIQUE | 8 equivalent formats → 1 identity | Low (multiple real SIMs remain possible) |
| Info disclosure | Visitor PII exposure on DB leak or backup | AES-256-GCM per field, random IV, AAD purpose binding, pinned 16-byte tag; phone lookup by keyed HMAC only | Crypto tests: tamper, wrong key, column swap rejected | Low |
| Info disclosure | Catalog leaks internal fields | Response serialised through a Zod contract (allow-list) | Test asserts no internal or PII keys | None |
| Tampering | Path traversal via the photo field | DB check: `photo_key` must be `<uuid>.webp` (server-generated) | Integration test with `../../etc/passwd` | None |
| Tampering | Malformed venue ranges silently disable the check | `cidr[]` column type rejects invalid ranges and set host bits | Integration test | None |
| Elevation | Dev seed silently turns the IP check off at the venue (S-8, Medium) | `--dev` explicit flag; refused in production | Manual check | None |
| DoS / Info | Test harness wipes a real database (S-9, Medium) | Refuses any DB not named `*_test` | Verified refusal on `mc` | None |
| Elevation | SMS pumping to premium/foreign numbers | Prefix allow-list (`+9627`) in the DB + mobile-type check | Phone tests | Low |

## Phase 2: On-site gate, OTP and visitor session

| STRIDE | Threat | Mitigation | Test / evidence | Residual |
|---|---|---|---|---|
| Spoofing | Off-site visitor passes the venue check with forged IP headers | Single trusted hop (ADR-002); gate enforced server-side on OTP request **and** verify; fails closed with no ranges | 3 unit + 3 integration tests; **live through Cloudflare** (forged XFF/X-Real-IP/True-Client-IP ignored) | Low (Wi-Fi bleed outside the hall; IPv6 prefix must be configured) |
| Spoofing | OTP brute force (10⁶ space) | Attempt taken **atomically before** comparison; max 5 per challenge; new code retires the old; resend cooldown + 5 requests/phone/hour | 5 wrong → `OTP_LOCKED`; **50 parallel guesses → exactly 5 evaluated** | Low: ≤25 guesses/phone/hour |
| Spoofing | OTP replay / double-submit | `consumed_at` flipped atomically; challenge bound by id | Concurrent double verify → one success; replay → `OTP_EXPIRED` | None |
| Spoofing | Forged or tampered session cookie | HMAC-signed (`SESSION_SECRET`), expiring, UUID-validated; HttpOnly, SameSite=Lax, Secure on https | Tamper/forge/garbage/missing → unauthenticated | Low (12 h cookie; logout/force-sign-out revoke server-side via `sessions_revoked_at`) |
| Tampering | CSRF on state-changing endpoints | Origin allow-list + `Sec-Fetch-Site: cross-site` refusal on non-GET; JSON-only bodies; SameSite=Lax | Cross-origin and cross-site → `CSRF_FAILED` (unit + live) | Low |
| Tampering | SMS template injection (message text rewriting the gateway request) | Placeholders replaced in JSON string values only | Test with a quote-breaking message | None |
| Info disclosure | OTP, phone, name leak via DB or logs | Code stored as keyed HMAC bound to challenge id; name/phone AES-GCM; logs redact `phone/code/otp/name/cookie`; console adapter logs only masked number | Live: 0 PII hits in API logs; ciphertext-only at rest | Low (console/demo adapters expose codes by design — gated by `DEMO_MODE`) |
| Info disclosure | Phone enumeration (who is registered / blocked) | Uniform request response; blocked status only revealed after the OTP proves ownership | Tests | Low |
| Info disclosure | Wi-Fi password leaked to off-site callers | `access/status` and gate errors expose the SSID only | Tests | None |
| DoS | SMS flood / pumping (cost) | Jordan-mobile prefix + type check; per phone/device/IP limits; **global hourly SMS ceiling**; IPv6 limits keyed per /64 | Cap tests (phone, global); `rateKey` tests | Low |
| DoS | Redis outage removes rate limits | Per-process fallback counters (≈ N× looser); Postgres-enforced cooldown and attempt lock are unaffected | Fallback test; Redis-down run in Phase 1 | Low |
| DoS | **Targeted griefing:** someone on the venue Wi-Fi keeps requesting codes for a victim's number, keeping the 60 s cooldown / 5-per-hour cap active so the victim cannot sign in | Attack needs presence on-site and ~1 request/min; every request is logged with IP + device | — | **Accepted (Medium impact, low likelihood).** Phase 6 adds an admin "clear OTP throttle for this phone" action; the victim also still has the SMS code the attacker triggered. |
| Elevation | Demo SMS adapters left on at the real event | API refuses to boot in production unless `DEMO_MODE=true` for `console`/`demo-inbox`; loud boot warning | Env tests; Phase 7 checklist | Low |
| Elevation | Blocked visitor keeps voting | `is_blocked` re-checked on session read and at sign-in | Test | None |
