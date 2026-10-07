# ADR-007: Admin authentication, sessions and authorisation

- **Status:** Accepted, 2026-10-07 (implements plan §2.4 "username + password, MFA" and §5.2)

## Context
The admin console controls everything that matters on the day: the voting window, the Blind Hour, the TVs, the visitors' personal data and the export. It is reachable from the internet through the same public address as the voter page, so it must be safe against a stranger with a password list, a stolen password, a stolen cookie, a cross-site page and an organiser's own mistakes. It must also be recoverable at the event by someone who has lost a phone, with no vendor and no email service.

Phase 5 builds the security core (API, operator CLI, tests). The console screens that use it arrive in Phase 6.

## Decisions

### 1. Passwords: argon2id from Node's own crypto, no new dependency
`crypto.argon2` (Node ≥ 24.7, enforced by `engines` and by a start-up check with a plain message; the image runs 24.21) with 64 MiB, 3 passes, 1 lane ≈ 150 ms. Hashes are PHC strings carrying their own parameters, so cost can be raised later and `needsRehash` upgrades an old hash at the next good sign-in. Passwords are NFKC-normalised. Policy follows NIST SP 800-63B: length (12 to 128 characters), not composition rules, plus a short deny-list of what attackers try first, no username inside the password, and not the current password. At most two hashes run at once per process (64 MiB each; a freed slot is handed straight to the next waiter, so a caller arriving at the same instant cannot take a third), and the rate limiter sits in front of the hash.

*Rejected:* the `argon2` npm package (a native add-on to build and to supply-chain, for no benefit); bcrypt (72-byte limit, less memory-hard); a hosted identity provider (needs accounts, internet and a vendor at an event with none of those guaranteed).

### 2. A second factor is mandatory for everyone
TOTP (RFC 6238: SHA-1, 6 digits, 30 s, ±1 step for clock drift), the one profile every authenticator app implements. There is no "skip MFA" and no SMS fallback for admins.
- The secret is 160 random bits, stored **AES-256-GCM encrypted** (purpose-bound AAD) and only trusted once a code proves it (`mfa_enabled`). A database check forbids `mfa_enabled` without a secret.
- **Each time-step works once.** The claim is one conditional `UPDATE … WHERE totp_last_step < $step`, so two parallel requests carrying the same code cannot both succeed (tested with eight at once).
- Enrolment can only start while MFA is **not** enrolled. Someone who has only the password can never replace an existing authenticator.
- Ten **recovery codes** (60 random bits, Crockford base32) are shown once at enrolment, stored only as HMACs keyed with the PII key (not `SESSION_SECRET`: rotating the cookie secret after a scare must not void every admin's recovery codes), single use, claimed atomically **inside the transaction that issues the session**, so a failure after the claim gives the code back. Using one reports how many remain. Regenerating them needs a fresh authenticator code and voids all old ones.

### 3. Sign-in is a state machine held on the server
```
password ──► pending session ──► [enrol authenticator] ──► code / recovery code ──► [replace temporary password] ──► ready
              (10 min, MFA routes only)                      (token replaced)            (every session replaced)
```
A password buys a **pending** session that lives 10 minutes and can reach only the MFA routes and logout; the route guard answers `MFA_REQUIRED` everywhere else. The stage is computed from stored state (`stage`: `mfa | enroll | password | ready`), never a flag the browser sends. When MFA completes, and again when the password changes, the session token is **replaced** (fixation defence): a token captured earlier is worthless afterwards.

### 4. Sessions live in Postgres; the cookie is a hashed bearer token
256 random bits in the cookie, only the SHA-256 stored, so a database leak yields no usable session and every replica can serve every request. Three clocks are enforced on every request: pending 10 min; full sessions 30 min idle and 8 h absolute (the absolute limit never slides). Admin disabled, temporary password expired, role changed: all take effect on the **next request**, because the account is joined in on every lookup.

Cookie: `__Host-mc_admin` over HTTPS (the browser then insists on Secure, host-only, Path=/), `HttpOnly`, `SameSite=Strict`. State-changing requests also need the per-session `x-csrf-token` (compared in constant time), on top of the global Origin check. Responses are `no-store`.

### 5. Lock-out: counted per account, on every wrong answer, never on the person already inside
Five wrong answers in a row (password **or** code) lock sign-in for 5 minutes; each further five doubles it, capped at an hour. Rules that matter:
- A correct password does **not** reset the counter; only a finished second factor does. Otherwise someone holding the password could reset it by logging in again and guess codes without limit.
- A locked account answers exactly like a wrong password (no oracle), and the password is not even checked.
- A lock ends sign-ins in progress but **never an established session**.
- A per-**address** rate limit (30 per 10 minutes) sits in front of all of it, before any hashing. There is deliberately **no per-username limit**: anyone could exhaust it for a known name and turn the real admin away even with the right password, a cheaper lock-out than the lock itself. Guessing against one account is what the lock is for.
- While an account is locked, a signed-in session also gets no further guesses at the sensitive prompts (current password, authenticator code for recovery codes): those answer 429 without checking, so a stolen session cannot guess a password forever. The session itself is left alone.

*Accepted trade-off:* someone who knows a username can keep that account locked out of **new** sign-ins. The impact is bounded (existing sessions survive; a SUPER_ADMIN or the operator CLI unlocks in one command) and the alternative, no lock-out, is worse. See residual risk R-A1.

### 6. Authorisation: one table, deny by default, enforced in `onRequest`
`PERMISSIONS` (permissions.ts) maps each capability to the roles that hold it. Every route under `/api/admin` must declare `config.access` (`public`, `pending`, `mfa`, or a permission); **a route without one stops the process booting**. The check runs before body parsing, reads the session, MFA state, password obligation and role from the database, and logs a refusal (`admin.access.denied`). Tests walk the real route table against an independently written expectation for five kinds of caller (anonymous, pending, password owed, ADMIN, SUPER_ADMIN), and walk the permission table on a bare server so a permission added in Phase 6 is covered the moment it exists.

Roles are `SUPER_ADMIN` and `ADMIN`. **`DISPLAY` is not an admin role:** a TV authenticates with its own revocable display token (ADR-006), uses a different cookie, and cannot reach `/api/admin` (tested).

Implemented now: `admins.read`, `admins.manage`, `audit.read` (SUPER_ADMIN only). Proposed for Phase 6 (to be confirmed when Phase 6 starts):

| Capability | Roles |
|---|---|
| Categories, exhibitors, photos, settings, voting window, Blind Hour mode and reveal, displays | SUPER_ADMIN, ADMIN |
| Read live counts during the Blind Hour (audit-logged, ADR-003), masked visitor list, clear an OTP throttle | SUPER_ADMIN, ADMIN |
| Unmask a visitor, export, demo SMS inbox, admin accounts, audit log | SUPER_ADMIN |

### 7. Account lifecycle, with invariants the service enforces
- A new account gets an **operator-issued temporary password** (20 random characters, shown once, stored hashed). It must be replaced at first sign-in and **expires in 48 hours** if unused, so a leaked or forgotten invitation does not stay a way in.
- **Reset credentials** is one operation that voids the password, the authenticator, the recovery codes and every session, then issues a new temporary password. Resetting only the authenticator would let anyone who knows the password enrol their own phone, so the two are never separated.
- Nobody can disable or re-role themselves; the last active SUPER_ADMIN cannot be disabled or demoted (a row lock serialises two SUPER_ADMINs demoting each other). Accounts are disabled, never deleted (the audit log keeps referring to them).
- The operator CLI (`pnpm stack:admin …`) is the bootstrap and the break-glass path and goes through the same service, so the same rules hold.

### 8. Everything security-relevant is audited, and nothing secret is
Sign-in success and failure, locks, refusals (only when the password was right, so hammering a disabled name cannot flood the log), MFA enrolment, recovery-code regeneration, password changes, logout, every account change and every denied access write to the append-only `audit_log`, in the same transaction as the change. A test scans the whole table for passwords, secrets, codes and tokens. An unknown username is not recorded (it is often a mistyped password).

## Consequences
- The auth surface lives in one directory (`modules/admin`, about 1,800 formatted lines including routes and account management), uses no auth framework and no native add-on. It is also ours to get right: the test suite is the safety net (86 tests, mutation-checked, §5 of the Phase 5 review).
- Admin sign-in is reachable from the internet. MFA, the lock-out and the rate limits are the protection; restricting `/api/admin` to the venue network or a VPN is possible later without changing this design (Phase 7 option).
- Recovery depends on a SUPER_ADMIN or the laptop operator. That is intentional: there is no email or SMS reset path to attack.
- WebAuthn / passkeys would be stronger than TOTP against phishing and are a natural future second factor; they were left out because they need a stable HTTPS relying-party identity on every device used and add UI surface a two-day build cannot afford.
