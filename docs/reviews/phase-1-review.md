# Phase 1 review: Domain & data

- **Date:** 2026-10-06
- **Scope:** schema + 3 migrations, integrity triggers, PII crypto, phone normalisation, catalog API, seed, integration harness, ngrok tunnel
- **Verdict:** ✅ Passed. No open Critical/High findings.

## 1. Automated checks

| Check | Result |
|---|---|
| Typecheck / ESLint / Prettier | ✅ |
| Tests | ✅ **66** (39 unit · 25 integration on real Postgres · 2 shared) |
| `pnpm audit` | ✅ 0 vulnerabilities |
| Semgrep (+ `p/sql-injection`) | ✅ 1 code finding fixed (S-10); only the accepted release-age deviation remains |
| `infra/tests/ip-spoof.sh` on the live stack | ✅ PASS |
| Live stack | ✅ migrations applied by the `migrate` job; catalog served via Caddy → 2 replicas |

## 2. Code review (`/code-review high`, 10 findings; each one verified)

| # | Finding | Severity | Outcome |
|---|---|---|---|
| C-1 | `audit_log` FK `SET NULL` UPDATEs append-only rows, so admins with history could never be deleted | Medium | **Fixed**: `RESTRICT` (migration 0002); admins are disabled, never deleted; regression test |
| C-2 | Test setup could `DROP SCHEMA` on any DB named by `TEST_DATABASE_URL` | High (data loss) | **Fixed**: refuses DBs not named `*_test` (S-9); verified |
| C-3 | Re-running the seed reverted admin edits (categories) and forced settings | High (access control) | **Fixed**: categories insert-only; settings only with explicit `--dev` (S-8); regression test |
| C-4 | ngrok crash-loops when `NGROK_DOMAIN` is unset | Medium | **Fixed**: `--url` passed only when set; verified both renderings |
| C-5 | ngrok free-plan browser warning page shown on first visit | Medium (UX/trust) | **Open, needs a decision**: see §4 |
| C-6 | Test reset could leak `session_replication_role=replica` into the pool | Medium (test integrity) | **Fixed**: `BEGIN; SET LOCAL …; COMMIT/ROLLBACK` |
| C-7 | Spoof test's fixed IP collides with the running ngrok container | Low | **Fixed**: runs inside the real ngrok container when the tunnel is up |
| C-8 | Bidi/format characters (Arabic contacts) made valid phones `INVALID` | Medium (UX: voters locked out) | **Fixed**: strip `\p{Cf}`; 3 new test cases |
| C-9 | Narrowed unit glob would silently skip future test folders | Low | **Fixed**: `test/**` minus `test/integration/**` |
| C-10 | `updated_at` never auto-updated | Low | **Fixed**: `$onUpdate` in the shared helper; regression test |

Design note: the `idempotency_key` column from the plan was dropped. Vote idempotency is natural: a retry hits `UNIQUE(visitor, category)`, and the API (Phase 3) will answer *200 already recorded* when the stored exhibitor matches, or *409* otherwise.

## 3. Security review (manual: STRIDE + OWASP ASVS)
The `/security-review` skill needs a git remote (`origin/HEAD`) and can't run on this local-only repo, so the review was done by hand against the same checklist. Details are in `docs/security/threat-model.md` (Phase 1 table).

| # | Finding | Severity | Outcome |
|---|---|---|---|
| S-7 | **Forged `CF-Connecting-IP` through the ngrok tunnel bypasses the venue allow-list** | **High** | **Fixed**: Caddy trusts only `X-Forwarded-For` (strict, right to left) from the ngrok IP; `ip-spoof.sh` regression |
| S-8 | Dev seed defaults inferred from `NODE_ENV` would turn the IP check OFF at the venue | Medium | **Fixed**: explicit `--dev`, refused in production |
| S-9 | Test harness could wipe a non-test DB | Medium | **Fixed** (= C-2) |
| S-10 | AES-GCM decipher without a pinned `authTagLength` (truncated-tag forgery class) | Low (not exploitable: exact 16-byte slice) | **Fixed**: `authTagLength: 16` on both cipher and decipher |

## 4. Open decision: ngrok browser warning (C-5)
On the free plan, ngrok shows a warning page on each visitor's **first** browser visit ("don't enter sensitive information unless you trust…"). The skip header only works for programmatic requests, not for a QR scan. Options:
- **A.** Cloudflare named tunnel on a domain you own: free, no warning page, and the code path existed in Phase 0.
- **B.** ngrok paid plan: removes the page.
- **C.** Keep ngrok free: each visitor taps "Visit Site" once. The API client will send `ngrok-skip-browser-warning` on every request regardless.

## 5. Backlog / residual risks

| # | Item | Severity | Plan |
|---|---|---|---|
| R-6 | The app connects as a Postgres superuser, which could bypass triggers via SQL injection (none known; all queries parameterised) | Medium | Phase 7: separate least-privilege `mc_app` role (DML only); migrations keep the owner role |
| R-1…R-5 | From Phase 0 | n/a | Unchanged |

## 6. Addendum: review of the Cloudflare tunnel switch (`/code-review` on 32d3862, 8 findings)

| # | Finding | Severity | Outcome |
|---|---|---|---|
| T-1 | IPv6 through Cloudflare's dual-stack edge would block real voters on an IPv4-only allow-list | High (availability of voting) | **Addressed**: ADR-002 now requires the venue's IPv4 **and** IPv6 prefixes; `cidr[]` supports both; Phase 2 "detect my IP" helper shows the family |
| T-2 | Trusted static IPs could be auto-assigned to another container | Medium | **Fixed**: `ip_range: 172.28.0.128/25` keeps the dynamic pool away from .10–.12 |
| T-3 | Spoof test simulates the connector hop (the cloudflared image has no shell) | Low | **Planned**: live end-to-end check through the real tunnel in Phase 2 via `GET /api/access/status` |
| T-4 | Spoof test counted restarting containers and exited 2 (ambiguous) | Low | **Fixed**: only `status=running`; fails closed with exit 1 |
| T-5 | Both connector IPs trusted at once | Low | **Accepted** (ADR-002): reserved addresses + host Docker access = already full compromise |
| T-6 | HSTS `includeSubDomains` now affects the team's whole domain | Medium | **Fixed** in Caddy and the API (helmet) |
| T-7 | An empty tunnel token crash-loops silently (QR shows Cloudflare 1033) | Medium | **Fixed**: `pnpm stack:tunnel` refuses to start without a token; `restart: on-failure:5` |
| T-8 | Master plan still told implementers to read `CF-Connecting-IP` | Medium (could reintroduce S-7) | **Fixed**: plan text aligned with ADR-002 |
