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
