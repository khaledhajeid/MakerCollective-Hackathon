# OWASP ASVS 5.0 checklist (Level 2 target), living document

Self-assessment, updated each phase for the chapters that phase touches. Chapters and sections are named as in ASVS 5.0.0; individual requirement IDs are deliberately **not** transcribed (they are easy to mis-copy), so each row states the requirement's intent and where the evidence is. Status: ✅ met · 🟨 partly met / accepted risk (see note) · ⬜ not yet applicable (later phase) · ➖ not applicable.

## Phase 5: admin security core

### V6 Authentication
| Section | Intent | Status | Evidence |
|---|---|---|---|
| V6.1 Documentation | Document rate limits, lock-out, and how credentials are handled | ✅ | ADR-007 §1–§5; threat model Phase 5 |
| V6.2 Password security | Min. length ≥ 8 (we require 12), allow long passphrases (128), no composition rules, deny-list of common passwords, Unicode normalised, no truncation, no password hints / security questions | ✅ | `password.ts`, `password.test.ts` (length by characters, NFKC, deny-list, username-in-password, same-as-current) |
| V6.2 Password security | Passwords stored with a memory-hard, salted, tunable hash | ✅ | argon2id 64 MiB / 3 / 1, PHC string with parameters, `needsRehash`; test: legacy hash upgraded on sign-in |
| V6.3 General authentication security | Throttle and lock out guessing; resist enumeration; no default accounts | ✅ | Per-address limit before hashing (none per username, by design); progressive lock that also bounds guesses at the sensitive prompts of a signed-in session; identical response and equal work for unknown / locked / disabled; no seeded admin (operator creates the first) |
| V6.3 General authentication security | Generic error messages; secrets not in URLs or logs | ✅ | One refusal message; credentials only in JSON bodies; pino redaction; audit scan test |
| V6.4 Factor lifecycle and recovery | Initial / temporary secrets are random, single use, expire; recovery does not weaken MFA | ✅ | 20-char random temporary password, forced change, 48 h expiry; reset voids password + authenticator + codes + sessions together |
| V6.5 Multi-factor requirements | A second factor for every account; code reuse prevented; throttled; recovery codes random, single use, hashed | ✅ | Mandatory TOTP; one-time step claim (8-way race test); lock applies to codes; 60-bit recovery codes, keyed hash, atomic single use |
| V6.5 Multi-factor requirements | Phishing-resistant factor for highest assurance | 🟨 | TOTP is phishable (R-A4); WebAuthn deferred (ADR-007) |
| V6.6 / V6.7 / V6.8 Out-of-band, cryptographic, identity provider | Not used for admins (no SMS for admins, no IdP) | ➖ | ADR-007 |

### V7 Session management
| Section | Intent | Status | Evidence |
|---|---|---|---|
| V7.2 Fundamental session security | Server-side session store; ≥ 128-bit random tokens; verified on a trusted backend; tokens rotated at authentication | ✅ | 256-bit token, SHA-256 at rest; replaced at MFA completion and password change (fixation tests) |
| V7.2 Fundamental session security | Cookie flags | ✅ | `__Host-`, `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, no Domain; checked live through the tunnel |
| V7.3 Session timeout | Idle and absolute timeouts | ✅ | 30 min idle, 8 h absolute, 10 min before MFA; tests with a controllable clock |
| V7.4 Session termination | Logout and administrative termination are effective server-side; password change ends other sessions | ✅ | Logout deletes the row; sign-out / disable / reset-credentials; password change ends all sessions |
| V7.5 Defenses against session abuse | Re-authenticate for sensitive changes; CSRF defence | ✅ | Password change needs the current password; recovery-code regeneration needs a fresh TOTP code; per-session CSRF token + Origin check + SameSite |
| V7.5 Defenses against session abuse | View / terminate own other sessions | 🟨 | Sessions are recorded (IP, user agent); a "my sessions" list is not built; an admin can be signed out everywhere by a SUPER_ADMIN, and a password change ends the others |

### V8 Authorization
| Section | Intent | Status | Evidence |
|---|---|---|---|
| V8.1 Documentation | Authorisation rules documented | ✅ | `permissions.ts` (data), ADR-007 §6, ADR-008 (final Phase 6 table) |
| V8.2 General design | Least privilege; enforced on a trusted service layer, not the client; deny by default | ✅ | `onRequest` guard; a route without a declaration cannot boot; role, status and password obligation read from the DB on every request |
| V8.3 Operation level | Every function checks permission; changes take effect immediately | ✅ | Route-table matrix test (5 caller types × every route); role change and disable effective on the next request |
| V8.4 Other considerations | Separation of administrative interfaces from user ones; separate credentials | ✅ | `/api/admin` has its own cookie, store and guard; display and visitor credentials are refused there |
| V8.x Administrative-interface network restriction | Optional extra layer | 🟨 | Not applied; owner decision pending (threat model R-A2) |

### V11 Cryptography
| Section | Intent | Status | Evidence |
|---|---|---|---|
| V11.2 / V11.3 Implementation, algorithms | Approved algorithms, no custom primitives | ✅ | `node:crypto` only: argon2id, AES-256-GCM, HMAC-SHA-256, SHA-256, SHA-1 inside HMAC for TOTP (RFC 6238 interoperability) |
| V11.4 Hashing | Keyed / salted hashes for low-entropy secrets; fast hashes only for high-entropy tokens | ✅ | Passwords: argon2id. Session tokens (256-bit): SHA-256. Recovery codes (60-bit): HMAC with a server key |
| V11.5 Random values | CSPRNG | ✅ | `randomBytes` / `randomInt` for tokens, secrets, codes, temporary passwords (rejection sampling, no modulo bias) |
| V11.1 Inventory | Documented keys and their custody | 🟨 | `SESSION_SECRET`, `PII_ENCRYPTION_KEY`, `PHONE_HASH_PEPPER` in `.env`; rotation is not implemented (R-A3) |

### V16 Security logging and error handling
| Section | Intent | Status | Evidence |
|---|---|---|---|
| V16.3 Security events | Log authentication events, failures, access-control failures, account changes | ✅ | audit rows for sign-in / failure / lock / refusal / MFA / password / logout / account change / denied access |
| V16.2 / V16.4 General logging, log protection | Who, when, where; no secrets; tamper resistance | ✅ | actor + IP + timestamp; append-only trigger; test scans the audit table for secrets |
| V16.5 Error handling | No internals in errors | ✅ | Uniform envelope; unknown errors become a generic 500 |

### Other chapters touched
| Chapter | Status | Note |
|---|---|---|
| V3 Web frontend security (cookies, CSP) | ✅ | CSP and cookie attributes as above; the console is plain React (no `dangerouslySetInnerHTML`), its axe scan is clean on 10 screens × laptop and phone |
| V4 API and web service (CSRF, content type) | ✅ | JSON-only bodies, Origin guard, CSRF token on state changes |
| V13 Configuration | ✅ | Boot fails on a route without an access declaration. Phase 7: explicit environment per container (no `env_file`), least-privilege database role, `stack:preflight` gate (ADR-009) |
| V14 Data protection | ✅ | Secrets encrypted or hashed at rest; responses are allow-lists; `Cache-Control: no-store` on every API response |
| V2 Validation and business logic | ✅ | Zod at the boundary for every body, parameter and query; domain invariants (last SUPER_ADMIN, self-protection) enforced in the service under row locks |
| V5 File handling | ✅ | Photo upload: size cap, structural WebP validation, no metadata, server-generated names, stored in the database, served `nosniff` (ADR-008) |
| V12 Transport | ✅ | TLS at the Cloudflare tunnel (HSTS, Secure `__Host-` cookie for admins); Caddy/API only on a private Docker network, data stores on loopback; `/api/readyz` not served at the edge |
| V15 Architecture | ✅ | Least privilege at three layers: DB role (DML allow-list), container (read-only, no capabilities, non-root), per-route permission table. Deny by default |
| V9 Tokens | ✅ | Visitor session: signed cookie, 12 h; admin: hashed 256-bit token, idle and absolute limits; display: hashed revocable token |
| V10 OAuth, V17 WebRTC | ➖ | Not used |
