# Data model (ERD)

PostgreSQL 17, schema in `apps/api/src/db/schema.ts`, migrations in `apps/api/drizzle/` (0000–0010). The design rule: **the database enforces what must never be wrong**; the application translates database outcomes into friendly answers.

## 1. Entity-relationship diagram

```mermaid
erDiagram
  settings {
    smallint id PK "always 1 (CHECK)"
    text event_name
    enum voting_status "SCHEDULED | OPEN | CLOSED"
    timestamptz voting_opens_at
    timestamptz voting_closes_at
    enum access_mode "IP_ALLOWLIST | OFF"
    cidr_array venue_cidrs "IPv4 and IPv6"
    text wifi_ssid
    text wifi_password
    enum results_visibility "LIVE | FROZEN | HIDDEN | REVEAL"
    jsonb frozen_snapshot
    timestamptz frozen_at
    jsonb revealed "per-category snapshots"
    text_array allowed_phone_prefixes
    int otp_ttl_seconds
    int otp_max_attempts
    int otp_resend_cooldown_seconds
    text consent_version
    int version "optimistic concurrency"
  }
  categories {
    uuid id PK
    text slug UK
    text name_en
    text name_ar
    text color "hex"
    int sort_order
    bool is_active
  }
  exhibitors {
    uuid id PK
    text name_en
    text name_ar
    text project_en
    text project_ar
    text booth
    text photo_key FK
    bool is_active
  }
  exhibitor_photos {
    text key PK "uuid.webp"
    bytea data "validated WebP, max 350 KiB"
    int width
    int height
  }
  exhibitor_categories {
    uuid exhibitor_id PK,FK
    uuid category_id PK,FK
  }
  visitors {
    uuid id PK
    text name_enc "AES-256-GCM"
    text phone_enc "AES-256-GCM"
    text phone_hash UK "HMAC-SHA256 + pepper"
    timestamptz vote_consent_at
    timestamptz outreach_consent_at
    text consent_version
    text locale "ar | en"
    inet created_ip
    text device_id
    bool is_blocked
    timestamptz sessions_revoked_at
  }
  otp_challenges {
    uuid id PK
    text phone_hash
    text code_hash "HMAC(challenge id + code)"
    text name_enc
    text phone_enc
    bool outreach_consent
    int attempts
    timestamptz expires_at
    timestamptz consumed_at
    inet ip
    text device_id
  }
  votes {
    uuid id PK
    uuid visitor_id FK
    uuid category_id
    uuid exhibitor_id
    inet client_ip
    timestamptz created_at
  }
  sms_outbox {
    uuid id PK
    text to_masked
    text body "demo-inbox mode only"
  }
  admin_users {
    uuid id PK
    text username UK
    text password_hash "argon2id"
    enum role "SUPER_ADMIN | ADMIN"
    text totp_secret_enc "AES-256-GCM"
    bool mfa_enabled
    bigint totp_last_step "replay guard"
    bool must_change_password
    int failed_attempts
    timestamptz locked_until
    bool is_disabled
  }
  admin_recovery_codes {
    uuid id PK
    uuid admin_id FK
    text code_hash
    timestamptz used_at
  }
  admin_sessions {
    text token_hash PK "SHA-256 of cookie token"
    uuid admin_id FK
    text csrf_secret
    bool mfa_verified
    timestamptz last_seen_at
    timestamptz expires_at "absolute"
  }
  display_tokens {
    uuid id PK
    text label
    text token_hash UK "SHA-256"
    uuid created_by FK
    timestamptz revoked_at
    timestamptz removed_at "hidden from the admin list; the row is never deleted"
  }
  audit_log {
    bigserial id PK
    timestamptz at
    uuid actor_admin_id FK
    text actor_label
    text action
    text entity
    text entity_id
    jsonb details
    inet ip
  }

  categories ||--o{ exhibitor_categories : "has"
  exhibitors ||--o{ exhibitor_categories : "competes in"
  exhibitor_photos ||--o| exhibitors : "photo_key"
  visitors ||--o{ votes : "casts"
  exhibitor_categories ||--o{ votes : "(exhibitor_id, category_id)"
  admin_users ||--o{ admin_recovery_codes : "owns"
  admin_users ||--o{ admin_sessions : "has"
  admin_users ||--o{ display_tokens : "created"
  admin_users ||--o{ audit_log : "acted"
```

`otp_challenges` is deliberately not linked to `visitors`: a registration is only a *pending* row until the code is verified. A visitor row exists only for a phone that proved it holds the number. `settings` is a single-row table (a `CHECK (id = 1)` makes a second row impossible).

## 2. The constraints that carry the integrity guarantees

| Guarantee | Mechanism | Table |
|---|---|---|
| One vote per visitor per category | `UNIQUE (visitor_id, category_id)` | `votes` |
| An exhibitor can only receive votes in a category it competes in | composite `FOREIGN KEY (exhibitor_id, category_id) → exhibitor_categories` (`ON DELETE RESTRICT`) | `votes` |
| A real person is counted once, however the number is typed | `phone_hash` = HMAC-SHA256(pepper, E.164) with `UNIQUE`; `+962 79 …`, `00962 79…`, `079…`, spaces, invisible direction marks and Arabic-Indic digits all normalise to one value first | `visitors` |
| Votes are final | trigger `votes_guard`: `UPDATE` always raises; `DELETE`/`TRUNCATE` only inside an explicit, audited reset (`SET LOCAL mc.allow_vote_reset`) | `votes` |
| The audit trail cannot be rewritten | triggers reject `UPDATE`, `DELETE`, `TRUNCATE`; the actor FK is `RESTRICT` so admins are disabled, never deleted | `audit_log` |
| Only one settings row, always present | `CHECK (id = 1)`, seeded by migration | `settings` |
| Settings stay sane | checks: window order, OTP ttl 60–900 s, attempts 1–10, cooldown 15–600 s; a `FROZEN` mode requires a stored snapshot | `settings` |
| Venue ranges are valid networks | column type `cidr[]` (Postgres rejects malformed input at write time) | `settings` |
| An account can't claim MFA without a secret | `CHECK (mfa_enabled = false OR totp_secret_enc IS NOT NULL)` | `admin_users` |
| Storage keys and photos are server-made and bounded | key pattern checks; `octet_length(data)` ≤ 358,400 | `exhibitor_photos`, `exhibitors` |
| A recovery code can't be duplicated | `UNIQUE (admin_id, code_hash)` | `admin_recovery_codes` |
| Dashboards hear about every change, whoever made it | statement-level triggers on `votes`, `settings`, catalog tables and `display_tokens` call `pg_notify('mc_results', tag)` (tag only, never data) | several |
| The API can't undo any of the above | application role `mc_app` has no `UPDATE`/`DELETE` on `votes` or `audit_log`, no DDL, cannot disable triggers (`provision.test.ts` asserts each is refused) | role |

Everything above is covered by integration tests that run **as `mc_app`**; the tests of the triggers and checks connect as the owner on purpose, so they are proven to hold even against a privileged connection.

## 3. Indexes

| Index | Serves |
|---|---|
| `votes (category_id, exhibitor_id)` | the leaderboard `GROUP BY` as an index-only scan |
| `exhibitor_categories (category_id)` | the catalogue read |
| `otp_challenges (phone_hash, created_at desc)`, `(device_id, created_at desc)` | resend cooldown and per-phone / per-device limits |
| `visitors (device_id)` | fraud lookups in the console |
| `admin_sessions (admin_id)`, `(expires_at)` | sign-out-everywhere and the expiry sweep |
| `audit_log (at desc)`, `(entity, entity_id)` | the audit screen |
| `sms_outbox (created_at desc)` | the demo inbox |

## 4. What is encrypted, hashed or plain

| Data | Form at rest | Why |
|---|---|---|
| Visitor name, phone | AES-256-GCM envelope (versioned, bound to the table/column as additional data) | readable only by the API with `PII_ENCRYPTION_KEY`; a database dump alone shows nothing |
| Phone, for uniqueness and lookups | HMAC-SHA256 with a secret pepper | deterministic, so it can be unique; cannot be reversed or brute-forced without the pepper |
| One-time code | HMAC of (challenge id + code) | a leaked table is useless; the code is never logged |
| Admin password | argon2id (PHC string) | memory-hard |
| Admin TOTP secret | AES-256-GCM envelope | needed in clear to verify a code, so encrypted not hashed |
| Recovery codes, admin session tokens, display tokens | SHA-256 of a 256-bit random value | high-entropy secrets: a fast hash is enough, and a leak gives no usable credential |
| Vote | plain: `visitor_id`, category, exhibitor, time, client IP | the vote ledger is pseudonymous: the visitor id is a random UUID, and the identity behind it needs the encryption key |
