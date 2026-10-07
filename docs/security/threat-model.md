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
| Tampering (client) | XSS / style injection through catalog fields | React escaping, no `dangerouslySetInnerHTML`; CSP `script-src 'self'`; category colour is DB-validated hex set via CSSOM; image URLs are server-built `/uploads/<uuid>.webp` | Semgrep 0 findings; DB check tests | Low (`style-src 'unsafe-inline'`, R-3) |
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

