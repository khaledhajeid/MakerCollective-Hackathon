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
| DoS | Large bodies | 64 KB body limit (the one photo route has its own 351 KB limit, Phase 6); 10 s statement timeout; pool cap | config | Medium: rate limits arrive in Phase 2 |
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

## Phase 3: Voting and the voter app

| STRIDE | Threat | Mitigation | Test / evidence | Residual |
|---|---|---|---|---|
| Spoofing | Vote without signing in, or with a forged/tampered session cookie | `POST /api/votes` requires a valid signed session resolved to a non-blocked visitor | 401 for missing, tampered, forged cookies | None |
| Spoofing | Stolen/old session used after logout or after a block | Server-side revocation (`sessions_revoked_at`) and `is_blocked` are checked on every vote | Vote after logout → 401; blocked visitor → 401 | Low (12 h cookie otherwise) |
| Elevation | Voting from outside the venue with a valid session (e.g. shared cookie) | Venue gate is a per-route preHandler on `POST /api/votes` (runs **before** the session check) | Outside IP + valid session → 403 `NOT_ON_VENUE_NETWORK`, 0 votes | Low (Wi-Fi bleed; IPv6 prefix must be configured) |
| Tampering | Two votes per category via parallel taps, retries or two devices | `UNIQUE(visitor_id, category_id)` arbitrates; same choice = idempotent success, different = 409 | 20 parallel different choices → exactly 1 vote; E2E finality | None |
| Tampering | Vote for an exhibitor outside the category, an archived exhibitor, or an inactive category | Eligibility query + composite FK | 422 `EXHIBITOR_NOT_IN_CATEGORY` tests | None |
| Tampering | Vote while voting is closed, not yet open, or unconfigured | `votingState()` with the server clock; unconfigured SCHEDULED fails closed | 4 refusal cases + unit tests | Low (≤ 2 s settings-cache lag across replicas) |
| Repudiation | Dispute about when/where a vote was cast | Each vote stores timestamp + canonical client IP | Integration test | Low (shared venue NAT IP) |
| Info disclosure | A visitor learns other visitors' votes or live counts | Vote responses return only the caller's own vote; `/me/votes` is `private, no-store`; no tally endpoint exists in this phase | Test: second visitor sees `[]` | None |
| Info disclosure | PII persisted in the browser | Name/phone stay in memory; `sessionStorage` holds only the masked phone and an opaque challenge id | Code review | Low |
| Tampering | UI claims "voted" when the server has not recorded it | Success only after HTTP 200; offline keeps the vote pending and retries the idempotent call | E2E: offline → no "recorded", 0 votes; reconnect → exactly 1 | None |
| DoS | Vote-endpoint spam | 60 requests/min per visitor; a person can cast only #categories votes | Covered by DB uniqueness; Phase 7 load test | Low |
| Tampering (client) | XSS / style injection through catalog fields | React escaping, no `dangerouslySetInnerHTML`; CSP `script-src 'self'`; category colour is DB-validated hex set via CSSOM; image URLs are server-built `/api/photos/<uuid>.webp` | Semgrep 0 findings; DB check tests | Low (`style-src 'unsafe-inline'`, R-3) |
| Info disclosure (third party) | Cloudflare's auto-injected analytics beacon observes visitors | CSP blocks it | Seen and blocked in the live run | **Action:** disable Web Analytics in the Cloudflare dashboard |

## Phase 4: Live results, TV displays and the Blind Hour

| STRIDE | Threat | Mitigation | Test / evidence | Residual |
|---|---|---|---|---|
| Info disclosure | **Live counts reach a TV browser during the Blind Hour** (DevTools, network tab, refresh, reconnect) | One function builds every frame (`buildFrame`); outside LIVE it never reads live counts: FROZEN serves the stored snapshot, HIDDEN/REVEAL-unrevealed serve nothing (`sealed: true`, `total: null`, no exhibitors) | Unit: the live reader is **not called** in FROZEN/HIDDEN/REVEAL. Integration + browser: 25-41 votes land during a freeze and **none appear in the raw event stream recorded in the browser**; a TV that connects mid-freeze gets the snapshot | None known |
| Info disclosure | A freeze race leaks post-freeze counts for a moment | `frame()` reads mode + votes in one `REPEATABLE READ` snapshot; a connecting TV always gets a freshly computed frame | Race regression tests (hub unit test; 10 connect-during-change iterations) | Low: a TV may show numbers up to the instant the freeze commits (they were true live numbers) |
| Info disclosure | Corrupt / missing snapshot falls back to live numbers | Snapshot and reveal list are schema-validated on read; invalid → everything sealed; DB check forbids `FROZEN` without a snapshot | Unit tests (4 corrupt shapes); DB check test | None |
| Info disclosure | An announced winner changes after the ceremony because votes keep arriving | Each `revealCategory` stores that category's standings at that moment | Integration: 100 late votes do not move an announced category | None |
| Spoofing | Anyone on the venue Wi-Fi reads the live stream | `GET /api/display/stream` requires a valid, unrevoked display token (HttpOnly cookie); no token → 401 | Auth tests (none, wrong, malformed, revoked) | Low |
| Spoofing | Display token guessed or stolen from a database leak | 256-bit random token; only its SHA-256 stored; shown once; revocable | Test asserts hash-only at rest; guessing space 2²⁵⁶ | Low (a token in a TV's browser profile is revocable; the pairing link is removed from the address bar at once) |
| Tampering | CSRF forces a TV to pair with an attacker's token | Origin allow-list on `POST /display/pair`; cookie is `SameSite=Strict`; an attacker needs a valid token anyway | Existing origin-guard suite | None |
| Repudiation | Who froze / revealed / created a display | `audit_log` rows written in the same transaction (`results.mode`, `results.reveal`, `display.create`, `display.revoke`) | Integration test | Low (CLI actions are labelled `cli:operator`; admin identity arrives in Phase 5) |
| DoS | Many connections exhaust an API replica | Hard cap of 200 streams per replica (429 beyond), slow sockets dropped at 512 KB backlog; only token holders can connect | Unit test (cap + slow-consumer drop) | Low |
| DoS | A vote burst becomes a query storm | Leading-edge throttle: ≤ 1 recomputation/s/replica regardless of votes; frames broadcast only when changed | Unit (500 notifications → ≤ 2 recomputations); integration (30 parallel votes → < 15 frames) | Low |
| DoS | Postgres drops the `LISTEN` connection or the API restarts | Reconnect with jittered backoff + resync; EventSource reconnects and gets a full frame; 5 s resync as a safety net; shutdown ends streams in `preClose` | Integration: `pg_terminate_backend` of the listener, then votes still arrive; restart test | Low |
| DoS | A stale / hung connection leaves a TV on old data | Heartbeat every 5 s; after 12 s of silence the TV shows a "reconnecting" notice and after 25 s reopens the stream; the last frame stays on screen | Code + browser run | Low |
| Elevation | A revoked TV keeps showing results | Hub re-checks open streams every 5 s and on the revocation notification; the TV drops its frame and shows the pairing screen | Browser test: revoke → pairing screen, results gone | Low (≤ 5 s) |
| Tampering (client) | XSS via exhibitor/category text on the TV | React escaping; no `dangerouslySetInnerHTML`; QR is generated client-side as inline SVG; frames are schema-validated before use and an unreadable frame never replaces a good one | Code review; Semgrep | Low (`style-src 'unsafe-inline'`, R-3) |
| Info disclosure | The pairing token leaks through logs, history or referrer | It is in the URL **fragment** (never sent), removed by `replaceState` immediately, then POSTed once in a body (logs redact bodies; `Referrer-Policy: no-referrer`) | Browser test: address bar clean after pairing | Low (the TV's browser history may keep the original link: revoke the display if a TV is lost) |
| Tampering | An organiser (or a slip of the finger) refreshes a sealed result by switching FROZEN → HIDDEN → FROZEN | `HIDDEN` keeps the snapshot and returning to `FROZEN` restores it; only `LIVE`/`REVEAL` discard it | Integration test: votes cast while hidden stay unseen after returning to FROZEN | None |
| Info disclosure | A transient database error at the moment of a freeze leaves TVs on live numbers until the next resync | A failed recompute re-arms the throttle and is retried within ~1 s; a TV that cannot get a current frame is refused | Hub unit tests (retry; mutation-checked) | Low: if the database stays down, TVs keep the last frame they already showed |
| DoS | Unlimited authenticated-read requests with well-formed but revoked/unknown cookies each cost a lookup | Malformed cookies are rejected before the database; well-formed ones are limited to 600/min/IP on `session` and `stream` | Code review | Low |

## Phase 5: Admin security core

Assets added: admin accounts and their authenticators, admin sessions, the audit log. New entry points: `/api/admin/*` (reachable from the internet through the same tunnel; see R-A2) and the operator CLI (needs shell access to the laptop, which already means game over for everything else). See ADR-007.

| STRIDE | Threat | Mitigation | Test / evidence | Residual |
|---|---|---|---|---|
| Spoofing | Password guessing / credential stuffing against `/admin/auth/login` | argon2id (≈150 ms/guess, 64 MiB); 30 attempts/10 min per address, checked **before** hashing (no per-username limit: it would be a cheaper lock-out than the real one); account lock after 5 wrong answers, doubling to 1 h; second factor mandatory | Integration: lock at 5, escalation 5→10→20→40→60 min, 429 before hashing, a burst on one username from other addresses does not stop the real admin; live run through the tunnel | Low |
| Spoofing | Username enumeration (message, status or timing) | One message and status for unknown / wrong / disabled / locked / expired; a decoy argon2 verification (pre-computed at boot) runs for unknown users; locked accounts are not even checked; an unknown name is not audited | Integration: identical bodies, unknown-user path ≥ 40 ms; mutation (decoy removed) caught | Low (a person who already has the right password can see whether MFA is set up: stage `mfa` vs `enroll`) |
| Spoofing | A stolen or guessed **password alone** | Pending session lives 10 min and reaches only the MFA routes (`MFA_REQUIRED` elsewhere, walked over every route); enrolment cannot overwrite an enrolled authenticator | Integration: route sweep with a pending session; "cannot overwrite" test; two-layer mutation caught | Low |
| Spoofing | TOTP guessing, or replaying a code seen over a shoulder | ±1 step only; each step usable once (atomic conditional UPDATE); every wrong code counts toward the lock; per-session and per-address limits | Integration: replay refused; **8 parallel requests, one winner** (mutation caught); drift tests; RFC 6238 vectors | Low |
| Spoofing | Bootstrap takeover: the operator-issued password leaks before first use | Temporary password is shown once, stored hashed, must be replaced at first sign-in, **expires in 48 h**, and the first sign-in still needs the person to enrol an authenticator; reset voids everything | Integration: expiry at 48 h (login and mid-session); reset-credentials sweep | Medium until the first sign-in: whoever signs in first with the temporary password enrols their own phone. Hand it over in person / on a private channel and sign in immediately (runbook) |
| Spoofing | Session theft: XSS, network, or a database leak | `HttpOnly` + CSP `script-src 'self'`; `__Host-`, `Secure` over HTTPS; only the SHA-256 of a 256-bit token is stored; 30 min idle / 8 h absolute | Live: cookie attributes via the tunnel; test: no clear token in the database | Low |
| Spoofing | Session fixation | The token is **replaced** when MFA completes and when the password changes (all other sessions end too) | Integration: old token dead after MFA; mutation (no rotation) caught | None |
| Tampering | CSRF against a signed-in admin | `SameSite=Strict`, global Origin check, per-session `x-csrf-token` compared in constant time | Integration: no / wrong / another session's token refused; cross-origin refused even with a valid token; mutation caught; live | None |
| Tampering | Privilege escalation through the account API | `admins.manage` is SUPER_ADMIN only; nobody can change their own role or disable themselves; the last active SUPER_ADMIN cannot be removed (row lock, concurrent demotion tested) | Integration incl. two SUPER_ADMINs demoting each other at once | None |
| Tampering | Audit log altered or erased | Append-only trigger (Phase 1), checked again here for the application role | Integration | Low (a superuser can still disable the trigger: R-6) |
| Tampering | A stolen **signed-in** session guesses the current password or authenticator code at the sensitive prompts | Wrong answers count toward the account lock, and while locked those prompts answer 429 without checking, so guesses are bounded to a handful per lock period; the session is not thrown out | Integration: 5 guesses then 429, right password also refused until the lock expires; mutation caught | Low |
| DoS | Filling the permanent audit log by hammering a disabled or expired username | A refusal is audited only when the password was right | Integration; mutation caught | None |
| Tampering | A credential is burned without the sign-in completing (database error mid-request) | The recovery code or time-step is claimed inside the same transaction that issues the session | Integration: forced failure leaves all 10 codes unused and the counter untouched; mutation caught | None |
| Repudiation | "I did not do that" | Every sign-in, failure, lock, refusal, MFA / password / recovery change, logout, account change and **denied access** is audited with actor and IP in the same transaction as the change | Integration + live | Low (CLI actions are `cli:operator`) |
| Info disclosure | Secrets in responses, logs or the audit log | Responses are Zod allow-lists (no hash, no TOTP field can be serialised); pino redacts passwords, codes, secrets and the CSRF header; a test scans the whole audit table and the whole admin tables for every secret used in the run | Integration | None |
| Info disclosure | Authenticator secret or recovery codes leaked from a database dump | Secret is AES-256-GCM encrypted with purpose-bound AAD (cannot be moved into another column); recovery codes are keyed HMACs; sessions are hashes | Integration: ciphertext envelope, wrong-purpose decrypt fails, no clear value in the dump | Low (the encryption key lives in the same `.env` as the database URL: R-A3) |
| DoS | Argon2 memory exhaustion | At most 2 concurrent hashes per process (≈128 MiB), a freed slot handed directly to the next waiter; limiter in front; stored-hash cost parameters are bounded when parsed | Unit tests (dangerous hashes fail closed; deterministic test of the hand-over race, mutation caught) | Low |
| DoS | **Lock-out griefing**: someone who knows an admin's username keeps the account locked | Locks never end an established session; the SUPER_ADMIN console and `pnpm stack:admin unlock` clear it; per-address limits slow a single attacker | Integration: lock leaves a signed-in session alone | **Medium (R-A1)**: see below |
| Elevation | A route ships without an authorisation decision | The process **refuses to boot**; the route table is walked by a test against an independent matrix for 5 caller types | Integration (real routes) + bare-server test (every permission × role) | None |
| Elevation | A disabled, demoted or expired admin keeps working | Account, role and password obligation are joined into every session lookup; disable also deletes sessions; the two layers are tested independently | Integration; mutations on each layer caught | None |
| Elevation | A display token or visitor cookie is used as admin credentials | Different cookie names and stores; display/visitor cookies are never read by the admin guard | Integration | None |

### Residual risks for Phase 5
- **R-A1 lock-out griefing (Medium, accepted):** a known username can be kept locked out of new sign-ins (and, while locked, a signed-in admin cannot change their password or regenerate recovery codes until the lock expires). Bounded by the points above; recovery is one command. A venue-network restriction on `/api/admin` (R-A2) would remove the remote attacker.
- **R-A2 admin sign-in is reachable from the internet (Medium, accepted for now):** MFA and the lock-out carry it. Option for Phase 7: an `ADMIN` access mode in settings that applies the venue allow-list (or a second allow-list) to `/api/admin`. Needs the owner's decision (Phase 5 review §7).
- **R-A3 key custody:** the TOTP encryption key is `PII_ENCRYPTION_KEY`, in `.env` beside the database credentials. Anyone who can read `.env` can read the database anyway. A KMS is out of scope for a laptop deployment.
- **R-A4 TOTP is phishable** (a look-alike page can relay a code in real time). WebAuthn would close it; deliberately deferred (ADR-007).


## Phase 6: Admin management and the console

Assets added: exhibitor photos, the event settings an organiser can change live, visitor identities behind the masked list, exports. New entry points: ~30 routes under `/api/admin` (all behind the Phase 5 guard) and one public route, `GET /api/photos/:key`. The console itself is a static SPA; it is not a security boundary (the API re-checks everything).

| STRIDE | Threat | Mitigation | Test / evidence | Residual |
|---|---|---|---|---|
| Tampering / Elevation | **Hostile or polyglot "photo"** (HTML/script, EXIF/GPS, animation, hidden trailing bytes) uploaded through the console or the API directly | The server never trusts the browser's re-encode: it parses the RIFF/WebP structure itself, accepts only `VP8 `/`VP8L`/`VP8X`/`ALPH` (+ one small ICC colour profile in its place), refuses animation/EXIF/XMP and any unknown chunk, requires every declared size to add up to the file length, checks the pixel dimensions (200-2400) and a 350 KB cap; served as `image/webp` with `nosniff` and a CSP of `default-src 'none'`; stored as `bytea` under a server-made UUID key (DB CHECKs on key format and size) | 13 refusal cases + accepted real browser output; mutation: each structural rule caught | Low: a crafted but structurally valid WebP could still target a decoder bug in a visitor's browser; needs an authenticated organiser |
| Tampering | Path traversal / arbitrary file read through the photo route | Keys must match `^[a-f0-9-]{36}\.webp$` (400 otherwise) and are looked up in a table, never on a file system | `../` and malformed keys tested | None |
| Tampering | **CSV / formula injection** in the export (a visitor registers as `=HYPERLINK(...)`, an exhibitor is named `@SUM(...)`) | Any cell starting `= + - @ TAB CR` is prefixed with `'`; only a strict `+<digits>` phone number and plain numbers are exempt; RFC 4180 quoting; UTF-8 BOM | Unit table + end-to-end exports with hostile names; mutation (guard off, phone rule loosened) caught | Low: a spreadsheet that ignores the apostrophe convention |
| Info disclosure | **Blind Hour broken from the console**: an organiser or a screen share sees who is ahead | The overview carries totals only (a test asserts no exhibitor appears in it); per-exhibitor counts exist only in `/results/live`, which outside LIVE mode writes an audit entry (once per five minutes per person) and shows a warning | Integration (overview JSON, audit once for 3 reads); mutation (no audit / flooding) caught | Medium (organiser discretion: the numbers are visible to them by design; the audit log is the control) |
| Info disclosure | **The Blind Hour broken through a file**: the results export or the vote ledger downloaded while the TVs are sealed | Both files answer 409 unless the results are LIVE (the ledger can be tallied per exhibitor); the Export screen says why and disables them | Integration: FROZEN, HIDDEN and REVEAL all refuse; Live allows | None |
| Info disclosure | Bulk PII leaves the system | Visitor list is masked (initial + dots, `+962 7•• ••• 567`); real name/phone only via `visitors.unmask` (**SUPER_ADMIN**, reason required, audited, auto-hides after 30 s); `outreach` export only for visitors who opted in and are not blocked; the vote ledger carries a keyed anonymous voter reference, never an id or phone; audit entries hold no PII (masked phone only) | Integration incl. the audit scan; mutations (unmasked list, blocked included, raw ids) caught | **Decision:** ADMIN may export (owner, 2026-10-07), which includes `outreach` PII. Mitigated by consent filter + audit + the action being a download, not a view |
| Elevation | ADMIN reaches SUPER_ADMIN functions (unmask, accounts, audit log, demo SMS inbox with live OTPs) | Separate permissions in the one table; the Phase 5 sweep walks every new route for five caller types | Integration; mutations (role widened) caught | None |
| Tampering | Settings overwritten silently by a second organiser or a stale tab | Optimistic `version`; 409 with an instruction; the console remounts the form on the new version | Integration (two writers) | Low (the one-click voting toggle sends no version by design) |
| Tampering | A mistyped range locks every visitor out, or opens the gate | CIDRs validated twice (syntax, then Postgres `cidr` incl. host-bits rule) before commit; console warns on "no network" and on "gate OFF" (Overview banner too) | Integration (malformed, host bits, /33); live check | Low |
| Tampering | Accidental destructive clicks on the day (close voting, Blind Hour, reveal) | Each is a named confirmation; closing voting and starting the reveal need a typed word; reveal per category is one-way by design (ADR-003) | Browser run | Low |
| Tampering | A blocked visitor keeps a live session | Block sets `is_blocked` and a revocation time stamped with the **app clock** (the one that stamps session issue times; a DB-clock version let an old session survive and was caught by a test) | Integration; mutation caught | None |
| DoS | An organiser (or a stolen session) uploads huge bodies | Only the photo route accepts a body above 64 KB, capped at 351 KB; the guard runs before body parsing | Integration (413) | Low |
| Repudiation | "I did not change that" | Every change is audited in the same transaction with actor, IP and a before/after diff of the changed fields (no secrets) | Integration (diffs; Wi-Fi password never logged) | None |
| Spoofing | OTP throttle misuse (an organiser clears a number to help someone) | Clears only stored codes and the hourly counter for one valid number; audited with the masked number; the per-device and per-IP limits stay | Integration | Low |

### Residual risks for Phase 6
- **R-C1 organisers can read live counts during the Blind Hour (Low-Medium, by design):** the audit log and the on-screen warning are the controls.
- **R-C2 export by ADMIN (owner decision):** see above; revisit if the export is ever used outside the organising team.
- **R-C3 the demo SMS inbox shows OTPs** to SUPER_ADMINs. It exists only while `SMS_PROVIDER=demo-inbox` (pre-event checklist: switch to `http`).

## Later console additions (2026-10-08)

| STRIDE | Threat | Mitigation | Test / evidence | Residual |
|---|---|---|---|---|
| Tampering / DoS | **A huge or hostile CSV** pushed through the bulk exhibitor import | The browser checks each row, but the server never trusts it: the same Zod schema per row, at most 300 rows, a 1 MB body limit on that one route only, all-or-none in one transaction, `content.manage` only, audited | Integration tests: 300 pass, 301 refused, one bad row or unknown category adds nothing | None known |
| Info disclosure / Injection | **The audit log leaves the system** as a file, or a hostile value in it runs as a spreadsheet formula | SUPER_ADMIN only (`audit.read`); the same formula-safe CSV writer as the other exports; the download is itself audited (`export.run`, row count) | Integration tests: ADMIN gets 403, ordering and format, a leading `=` is neutralised, the export is logged | Low: whoever holds the file holds the log, as with any export |
| Repudiation | A TV is removed to hide that it was ever paired | The API role cannot delete `display_tokens`; removal only sets `removed_at` and revokes, and is audited as `display.remove` with the label | Integration test: rows kept, token no longer pairs, audit entries exist | None |

## Phase 7: Hardening and event operations

Assets added: none. New operator tools: `stack:preflight`, `stack:reset-event`, the load harness (`load/`, test machine only). Changes to the trust boundary: the API's database identity, the container privileges, the edge's public surface (ADR-009).

| STRIDE | Threat | Mitigation | Test / evidence | Residual |
|---|---|---|---|---|
| Elevation / Tampering | **SQL injection or a stolen `DATABASE_URL` used to switch off the vote and audit triggers, rewrite votes or read server files** (R-6) | The API connects as `mc_app`: no superuser, no DDL, no `TRIGGER`/`TRUNCATE`, `UPDATE`/`DELETE` only on listed tables and never on `votes`, `audit_log`, `visitors`, `settings`; grants rebuilt from an allow-list on every start | `provision.test.ts` (each attack gets SQLSTATE 42501); the whole 361-test integration suite runs as `mc_app`; preflight fails if the role is missing or privileged | Low: a bug could still *insert* bogus votes or read data the API may read |
| Info disclosure | Secrets reach a compromised API container (tunnel token, database owner password) | No `env_file`: explicit variable list; the owner password goes to the migrate container only | `docker exec … env` check | Low: the API still holds `SESSION_SECRET`, the PII key and the `mc_app` password, by necessity |
| Elevation | Container breakout / persistence after a remote-code-execution bug | API and Caddy: read-only root, all capabilities dropped, `no-new-privileges`, process and memory limits; API as `node`, Caddy as uid 1000 | Compose config; `touch /x` fails; `id` | Low |
| Info disclosure | Dependency status (database / Redis up or down) readable by anyone (R-1) | `/api/readyz` answers 404 at the edge | Checked through Caddy and by the preflight | None |
| Info disclosure | A failed query writes a session hash, phone hash or name into the logs | Error serializer drops bound parameters and driver `detail` | `log-scrub.test.ts` | None known |
| Tampering | Rehearsal data counted in the real event | `stack:reset-event` (shows counts by default; deleting needs the confirmation word and the exact vote count, refuses while voting is open, re-checked under a row lock, audited) and a preflight FAIL when test data exists | Run on the load database | Low: operator must run it |
| Elevation | Event started with demo SMS, the gate off or the demo catalogue | `stack:preflight` fails on each (SMS provider, demo mode, non-production build, gate off/empty, placeholder exhibitors, privileged role, no authenticator-enrolled super admin) | Pure-function table tests | Low: operator must run it |

### Residual risks after Phase 7
- **R-3 `style-src 'unsafe-inline'` (Low, accepted):** inline `style` attributes from React and the animation code; scripts remain `'self'` only.
- **R-A2 admin reachable from the internet (Medium, owner decision):** a Cloudflare Access / WAF rule closes it without code (runbook `event-day.md`).
- **R-5 the laptop is a single point of failure (accepted for the demo host):** see the load report for the application layer.
