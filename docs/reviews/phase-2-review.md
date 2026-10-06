# Phase 2 review: On-site gate, OTP & visitor session

- **Date:** 2026-10-06
- **Scope:** venue-IP gate + `GET /api/access/status`, settings cache, rate limiter, SMS adapters (ADR-004), OTP request/verify, visitor session cookie, CSRF origin guard, migration 0003, env changes
- **Verdict:** ✅ Passed for the self-review below. A fresh `/code-review` of the Phase 2 commit is recommended before Phase 3 (the Phase 1 pass found 10 issues that self-review had missed).

## 1. Tunnel verification (requested first)
`GET /api/access/status` was built and tested **before** the rest of Phase 2, then checked through the real tunnel (`https://vote.alrabetahub.app`, Cloudflare named tunnel → `cloudflared` → Caddy → API). Results are recorded in ADR-002: the API reports the laptop's real public IP (matches `api.ipify.org`), every forged header is ignored (Cloudflare itself rejects a forged `CF-Connecting-IP`), and the gate admits/refuses/fails closed as designed. **IPv6 not yet verified on a real IPv6 phone** (this laptop has no IPv6 route): verified in unit tests only; on-site checklist item.

## 2. Automated checks

| Check | Result |
|---|---|
| Typecheck / ESLint / Prettier | ✅ |
| Tests | ✅ **120** (shared 2, API unit + integration 118 on real Postgres) |
| `pnpm audit` | ✅ no known vulnerabilities |
| Semgrep (default, TypeScript, SQL-injection, JWT rules) over `apps/api/src`, `packages/shared/src`, `infra` | ✅ no findings |
| Live stack through the tunnel | ✅ gate refusal → OTP request → wrong code → right code → session cookie → replay refused → cross-site POST refused; PII ciphertext at rest; 0 PII hits in API logs |

## 3. Self-review: issues found and fixed before this gate

| # | Finding | Severity | Outcome |
|---|---|---|---|
| P-1 | Impatient re-taps of "resend" inside the cooldown spent the visitor's per-phone hourly quota, so 5 taps locked a legitimate visitor out for an hour | Medium (voter lock-out) | **Fixed:** cooldown is checked before the per-phone limiter; regression test |
| P-2 | IPv6 clients could dodge per-IP limits by rotating addresses inside their /64 | Medium (anti-fraud) | **Fixed:** rate-limit keys collapse IPv6 to the /64 (`rateKey`, tested) |
| P-3 | Per-device cap of 6/h would block a visitor correcting several mistyped numbers | Low (UX) | **Fixed:** raised to 10/h (device is not a security boundary; phone and IP limits remain) |
| P-4 | ADR-004 said demo adapters are "refused in production", but the pitch runs the production image | Medium (design contradiction) | **Fixed:** explicit `DEMO_MODE=true` opt-in; boot refused without it; loud boot warning; ADR updated |
| P-5 | Per-route gate keyed off `routeOptions.url`, which includes the `/api` prefix, would have silently skipped the gate | High (access control) | **Fixed before first run:** gate is a per-route `preHandler`; tests cover both OTP endpoints |

## 4. Security review (STRIDE / OWASP ASVS V2, V3, V4, V11)

Full table: [`docs/security/threat-model.md`, Phase 2](../security/threat-model.md). Highlights:
- **V2 (authentication, OTP):** 6-digit CSPRNG code, HMAC-hashed and bound to the challenge id, single use, 5-minute TTL, attempt cap taken atomically **before** comparison (50 parallel guesses → exactly 5 compared), newest code retires older ones, resend cooldown serialised by a Postgres advisory lock (8 parallel requests → 1 SMS).
- **V3 (session):** signed expiring cookie, HttpOnly, SameSite=Lax, Secure on https; tamper/forge/garbage rejected; `is_blocked` revokes immediately.
- **V4 (access control):** venue gate enforced server-side on both credential endpoints; forged proxy headers cannot change the result; fails closed.
- **V11 / CSRF:** Origin allow-list + `Sec-Fetch-Site` refusal on every non-GET.
- **Privacy:** consent is required; outreach consent is separate and optional; name/phone only as ciphertext; logs contain no PII.

### Accepted / open items

| Item | Severity | Decision |
|---|---|---|
| Targeted OTP-throttle griefing by someone on the venue Wi-Fi (keeps a victim's cooldown active) | Medium impact / low likelihood | Accepted; Phase 6 adds an admin "clear OTP throttle" action |
| Visitor session is a stateless 12 h cookie (no server-side revocation list) | Low | Accepted; `is_blocked` covers the abuse case |
| Rate limits are per process while Redis is down (≈ N× looser) | Low | Accepted; Postgres-enforced limits unaffected |
| `/api/access/status` and `/api/auth/session` have no per-IP limit | Low | Cheap, cached reads; covered by the Phase 7 load test |
| IPv6 path unverified on a real phone | Medium until verified | On-site checklist item |
| `env_file: ../.env` passes every `.env` value (incl. the tunnel token) into API containers | Low | To be narrowed in Phase 7 hardening |

## 5. Test map (what proves what)
- `lib/ip.test.ts` (IPv4/IPv6 CIDRs, mapped addresses, rate keys), `lib/rate-limit.test.ts`, `modules/sms/adapters.test.ts`, `test/access.test.ts` (7), `test/app.test.ts` (env rules).
- `test/integration/auth.test.ts`: venue gate (outside, forged headers), happy path, ciphertext at rest, phone formats → one identity, Arabic-Indic OTP, consent, foreign/landline/garbage numbers, lock-out, parallel guesses, cooldown, advisory-lock race, retire-old-code, single use, expiry, gateway failure rollback, per-phone and global caps, session tampering, blocked visitor, Secure cookies, logout, CSRF.

## 6. Gate decision
Phase 2 is functionally complete. **Waiting for your approval before Phase 3** (voting core + the mobile UI, where the `impeccable` design process starts).
