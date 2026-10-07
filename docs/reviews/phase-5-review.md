# Phase 5 review: Admin security core

- **Date:** 2026-10-07
- **Scope:** admin accounts, argon2id sign-in, mandatory TOTP + recovery codes, DB-backed sessions, CSRF, lock-out, RBAC guard and permission table, audit trail, operator CLI (`pnpm stack:admin`), migration 0008, ADR-007, threat model, ASVS checklist, runbook. **No admin screens**: they arrive with the console in Phase 6 (the API they will call is finished and tested).
- **Verdict:** ✅ Built, verified end to end on the real stack (HTTP through Caddy and HTTPS through the public tunnel), and mutation-checked. No open Critical/High findings from my own review. **Three decisions are waiting for you (§7).** The `/code-review` and `/security-review` rounds are yours to run; §9 records the `/code-review` round and §10 the `/security-review` round (both done).

## 1. Plan acceptance criteria

| Criterion (plan §6, Phase 5) | Result |
|---|---|
| Tests: **no MFA bypass** | ✅ A session that has passed the password has a 10-minute life and reaches only the MFA routes; the route guard answers `MFA_REQUIRED` for every other route, **swept over the whole real route table** (a fresh pending session per route). Also: a second factor can only be enrolled while none exists (a stolen password cannot swap in another phone), a code cannot be replayed (8 parallel requests with one code: exactly one wins), lock-out counts wrong codes, the token is replaced when MFA completes. |
| Tests: **RBAC matrix enforced** | ✅ Every real `/api/admin` route is exercised for five kinds of caller (anonymous, password-only, password owed, ADMIN, SUPER_ADMIN) against an independently written expectation; a bare-server test walks `PERMISSIONS` × roles so any permission Phase 6 adds is covered the moment it exists; a route that declares no access **stops the process booting**. |
| argon2id | ✅ `node:crypto` argon2id, 64 MiB / 3 passes (≈150 ms), PHC strings, upgrade-on-sign-in, decoy hash for unknown users |
| TOTP MFA + recovery codes | ✅ RFC 6238 (the RFC's own test vectors pass), AES-256-GCM encrypted secret, 10 single-use recovery codes stored as keyed hashes |
| DB sessions, CSRF, lock-out, audit | ✅ see ADR-007 §4, §5, §8 |

## 2. Automated checks

| Check | Result |
|---|---|
| Typecheck / ESLint / Prettier (`pnpm check`) | ✅ |
| Unit + integration | ✅ shared 2 · web 43 · API **281** (was 195: **+23** unit for TOTP, passwords and the hashing gate, **+63** integration on real Postgres) |
| `pnpm audit --prod` | ✅ no known vulnerabilities (no dependency added: argon2 and TOTP use `node:crypto`) |
| Semgrep / gitleaks / osv-scanner | not installed on this laptop; they run in CI (`ci.yml`) |
| Live acceptance, real stack | ✅ 28 checks, below |

### Live acceptance (2 API replicas behind Caddy; the public Cloudflare tunnel)
Bootstrapped with `pnpm stack:admin create`, then walked the whole journey over plain HTTP and over `https://vote.alrabetahub.app`: wrong and unknown user get the identical refusal · password → "enrol" stage · a password-only session is refused (`MFA_REQUIRED`) · enrol with a real TOTP secret and code, 10 recovery codes · temporary password blocks the console (`PASSWORD_CHANGE_REQUIRED`) until replaced · weak password refused · console API opens · state change without CSRF token → 403 · cross-origin with a valid token → 403 · create / disable an admin · audit log holds the story and **none** of the secrets used · **through the tunnel:** cookie is `__Host-mc_admin; Secure; HttpOnly; SameSite=Strict; Path=/` with no Domain, TOTP sign-in, the code just used is refused, a recovery code typed in lowercase without dashes works (9 left), logout kills the cookie, the audit log shows the real client IP, a lock-out leaves the signed-in session alone.
Afterwards the throw-away account was **reset** (its password, authenticator and sessions are void) and the scratch files holding its credentials deleted. It still exists in the event database: see §7.

## 3. Self-review: defects found by testing, fixed before this gate

| # | Found by | Defect | Fix |
|---|---|---|---|
| 1 | Integration test | Creating an admin with a taken username returned **500** instead of 409: Drizzle wraps the driver error, so the SQLSTATE is on `cause`, not on the error | `pgErrorCode()` walks `cause`; the same latent bug in the display CLI's friendly-error path is fixed with it |
| 2 | Re-reading my own code as an attacker | The decoy hash that makes unknown-username sign-ins cost the same was computed **lazily**, so the first unknown-user attempt after every restart took twice as long: a username oracle | Computed at boot (service constructor) |
| 3 | Mutation testing (§5) | The "two parallel requests, one code" test still passed with the atomic claim **removed** (the two requests happened to serialise) | Test now fires 8 at once for TOTP and for recovery codes; mutation killed |
| 4 | Mutation testing | Nothing tested the **per-request** disabled check separately from "disable deletes sessions" (one layer hid the other), nor a temporary password expiring mid-session | Two tests added (disabled flag set straight in SQL; expiry while signed in) |
| 5 | Test design | Three of my own tests were wrong (a lock-out test tripped the rate limiter; an 8-hour test let the session idle out; a sweep logged itself out) | Rewritten; the lock escalation is its own deterministic test |

## 4. Security review (STRIDE + ASVS)
Threat model: `docs/security/threat-model.md` → *Phase 5* (18 rows, residual risks R-A1…R-A4). ASVS 5.0 self-assessment: `docs/security/asvs-checklist.md` (V6, V7, V8, V11, V16 plus the other chapters touched; two rows are partly met and say why).

## 5. Mutation check (does the suite catch a broken guarantee?)
Each row breaks one security property in the code; the matching tests must fail.

| Mutation | Caught |
|---|---|
| CSRF check removed | ✅ |
| "MFA completed" check removed from the guard | ✅ |
| `can()` returns true for everyone | ✅ |
| A lock-out also ends fully signed-in sessions | ✅ |
| TOTP step claim made non-atomic | ✅ (after fix #3) |
| No decoy hash for unknown users | ✅ |
| Session token not replaced at MFA completion | ✅ |
| Last SUPER_ADMIN can be removed / concurrent demotion | ✅ |
| Disabled admin keeps working | ✅ (after fix #4) |
| No idle timeout / no absolute timeout | ✅ / ✅ |
| A correct password resets the failure counter | ✅ |
| Enrolment may overwrite an existing authenticator | ✅ with both layers removed; either layer alone still blocks it (two independent layers by design, so removing one is not detectable, which is the point) |
| Temporary password never expires (mid-session) | ✅ (after fix #4) |
| Password change leaves other sessions alive | ✅ |
| Unlock does not clear the lock | ✅ |

16 of 18 mutants killed in the first run (the 2 survivors are the single-layer enrolment mutants described above); the 8 mutants for the `/code-review` fixes (§9) are all killed.

## 6. Accepted / open items
| Item | Severity | Disposition |
|---|---|---|
| R-A1 lock-out griefing: a known username can be kept locked out of **new** sign-ins | Medium | Accepted: bounded (existing sessions survive; one command unlocks). Removed entirely if you choose to restrict admin to the venue network (§7, decision 2) |
| R-A2 `/api/admin` reachable from the internet | Medium | Accepted for now; decision 2 |
| First-use window of a temporary password | Medium | Mitigated: 48 h expiry, shown once, runbook says hand over in person and sign in at once |
| R-A3 TOTP key custody (same `.env` as the DB URL) | Low | Accepted (laptop deployment) |
| R-A4 TOTP is phishable | Low | WebAuthn deferred (ADR-007) |
| "My sessions" screen, password-strength meter, recovery-code low-stock warning | Low | Phase 6 UI (the API already reports codes remaining) |
| Phase 1 backlog (R-1 `/readyz` Redis, R-2 Caddy root, R-3 CSP `unsafe-inline`, R-5 SPOF, R-6 superuser DB role) and Phase 4 items | Low | Unchanged; Phase 7 |

## 7. Decisions needed from you
1. **MFA is mandatory for every admin** (the brief said "MFA if possible"). I chose mandatory because one stolen password would otherwise control the Blind Hour and the visitors' phone numbers. The cost is a two-minute first sign-in per organiser. *Recommend: keep.*
2. **Should `/api/admin` be limited to the venue network at the event?** Today it is reachable from anywhere with MFA and lock-out as the protection. Restricting it (a setting, off by default, built in Phase 7) removes the remote attacker and R-A1, but organisers could not use the console from home or on mobile data. *Recommend: keep it open until you see the console; decide in Phase 7.*
3. **The Phase 6 permission table** in ADR-007 §6 (who may do what). The one rule from the plan I applied literally: unmasking and exporting visitors needs SUPER_ADMIN. *Recommend: confirm at the start of Phase 6.*

**Action for you now:** create your own account: `pnpm stack:admin create <your-username> SUPER_ADMIN`, sign in once (Phase 6 gives this a screen; until then the runbook shows the API calls) and then `pnpm stack:admin disable livecheck` (my throw-away account; it has no usable credentials, but should not exist at the event). It can only be disabled once a second SUPER_ADMIN exists: the system refuses to be left without one.

## 8. Test map
| Area | Where |
|---|---|
| TOTP (RFC 6238 vectors, drift, replay, base32, otpauth URI) | `modules/admin/totp.test.ts` (11) |
| Passwords (argon2id, NFKC, dangerous stored hashes, rehash, decoy, policy, generator) | `modules/admin/password.test.ts` (9) |
| Sign-in, lock-out and escalation, rate limits, rehash | `admin.test.ts` › *sign-in* |
| Second factor, replay, drift, parallel claims, malformed bodies | › *second factor* |
| Enrolment, overwrite refusal, recovery codes | › *authenticator enrolment*, *recovery codes* |
| Session lifetimes, logout, disable, cookie attributes (HTTPS) | › *session lifetime* |
| CSRF | › *CSRF* |
| Temporary passwords, password change | › *temporary passwords* |
| RBAC sweep, role changes, display token ≠ admin | › *authorisation (RBAC)*, *the guard, in isolation* |
| Account management invariants | › *admin account management* |
| Audit completeness, no secrets, append-only | › *audit log* |
| Data at rest | › *data at rest* |

## 9. `/code-review` round (9 findings: all addressed)

| # | Finding | Verdict | Fix |
|---|---|---|---|
| 1 | `crypto.argon2` needs Node 24.7 but `engines` allowed ≥ 22.12 (the whole API would fail to boot on an older Node) | Valid | `engines` ≥ 24.7; a start-up check with a plain message |
| 2 | Account updates locked the target row, then the set of SUPER_ADMINs, in a different order in different transactions: two crossing updates can deadlock (500 instead of 409) | Valid | One lock order everywhere: the SUPER_ADMIN set (by id) first, then the target; a test fires crossing updates |
| 3 | The recovery code / TOTP step was spent *before* the transaction that issues the session: a failure in between burns it with no session | Valid | The claim now runs inside that transaction (also for recovery-code regeneration); test forces a failure and shows nothing was spent |
| 4 | The per-username limiter lets anyone exhaust it for a known name and turn the real admin away (a cheaper lock-out than the real one); and a valid password revoked the admin's pending MFA session | Valid | Per-username limiter **removed** (per-address stays; the account lock covers per-account guessing); login no longer revokes other pending sessions. Documented in ADR-007 §5 |
| 5 | The hashing gate let a third 64 MiB hash in when a caller arrived between a slot being freed and its waiter resuming; and a failed decoy-hash attempt was cached forever (every unknown-username sign-in would then fail with a 500) | Valid | Slot handed directly to the waiter; the cached rejection is cleared. A deterministic test reproduces the interleaving (the mutant gives `expected 3 to be 2`). The decoy-retry path has no test (it needs a failing hash) |
| 6 | A stolen **signed-in** session can guess the current password indefinitely at the password-change prompt (the lock only ended pending sessions) | Valid | While the account is locked, that prompt and recovery-code regeneration answer 429 without checking; the session is not thrown out (so a stranger who merely locked the account cannot eject the real admin) |
| 7 | Every unauthenticated login against a disabled / expired account wrote a permanent audit row | Valid | Audited only when the password was right |
| 8 | Recovery codes were keyed with `SESSION_SECRET`: rotating the cookie secret silently voids every code | Valid | Keyed with the PII key (which cannot be rotated casually) |
| 9 | The recovery-code block and the `Tx` type were duplicated; a comment named a test file that does not exist | Valid | One `issueRecoveryCodes` helper, one exported `Tx`, comment corrected |

Tests added for the fixes: 10 (gate: 2, integration: 8). Each fix was mutation-checked by putting the old behaviour back and confirming a test fails (8 of 8). After the round: API 281 tests, all green; the Docker stack was rebuilt so what runs is what is committed.

## 10. `/security-review` round (run on the final code, after §9's fixes)

**No findings at or above the bar (confidence ≥ 8/10).** An independent pass read every new file (guard, routes, service, sessions, users, password, totp, recovery, audit, permissions, CLI, schema, migration, shared schemas) and the existing code they sit beside. It did not enumerate the rest of the repository, so a plugin registered elsewhere could in principle have been missed; none is in the dependency list.

Checked and holding: the guard's every branch fails closed (and a route without a declaration cannot boot); CSRF on every state change including `pending` routes; only the MFA-verify, enrolment-confirm and password-change paths create a fully authenticated session; tokens replaced at each privilege change; TOTP step and recovery code claimed atomically inside the session-issuing transaction; lock enforced at login, MFA, password change and recovery regeneration; generic failure messages and decoy hash; account management locked to SUPER_ADMIN with the last-SUPER_ADMIN rule; no raw SQL with user input; no response can serialise a hash or TOTP secret.

Considered and not raised (all below the bar or excluded by the review rules), for the backlog:

| Candidate | Why it stays in the backlog |
|---|---|
| Several pending sessions racing past the lock check before the first failure commits | A few extra 6-digit guesses at roughly 0.0003% each: a rate-limit weakness |
| Rehash on login writes from a stale read | Only when the argon2 cost parameters change; theoretical |
| TOTP ciphertext is bound to a purpose, not to the admin id | Swapping needs database write access |
| A database error log line could include a session's CSRF secret | Needs a database fault, and the cookie is needed as well. Phase 7: scrub query parameters from error logs |
| No CSRF token on the login endpoint | Covered by `SameSite=Strict` and the Origin / Sec-Fetch-Site checks; the result is only a pending session |
| Audit `before` cursor has no upper bound | A 500 at most (Phase 6: cap it in the schema) |

**Outcome:** zero open Critical/High/Medium findings from either review round. The three decisions in §7 are still the owner's.
