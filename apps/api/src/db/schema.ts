/**
 * MC2026 database schema (plan §3.4). Integrity rules are enforced HERE, not only in
 * application code, so no race, retry or bug in any replica can produce an invalid vote:
 *  - one vote per visitor per category ........ UNIQUE (visitor_id, category_id)
 *  - exhibitor must belong to the category ...... composite FK → exhibitor_categories
 *  - one visitor per real phone number ......... UNIQUE (phone_hash)
 *  - votes are final ........................... no UPDATE path; trigger rejects UPDATE
 *  - exhibitors/categories with votes .......... cannot be deleted (archive via is_active)
 */
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  cidr,
  foreignKey,
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { ACCESS_MODES, ADMIN_ROLES, RESULTS_VISIBILITY, VOTING_STATUS } from '@mc/shared';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const resultsVisibility = pgEnum('results_visibility', RESULTS_VISIBILITY);
export const accessMode = pgEnum('access_mode', ACCESS_MODES);
export const votingStatus = pgEnum('voting_status', VOTING_STATUS);
export const adminRole = pgEnum('admin_role', ADMIN_ROLES);

/* ───────────────────────────── Event settings (singleton) ───────────────────────────── */

export const settings = pgTable(
  'settings',
  {
    id: smallint('id').primaryKey().default(1),
    eventName: text('event_name').notNull().default('The Maker Collective 2026'),

    // Voting window: OPEN/CLOSED are manual overrides; SCHEDULED follows opens_at/closes_at.
    votingStatus: votingStatus('voting_status').notNull().default('SCHEDULED'),
    votingOpensAt: timestamp('voting_opens_at', { withTimezone: true }),
    votingClosesAt: timestamp('voting_closes_at', { withTimezone: true }),

    // On-site access (ADR-002). cidr[] lets Postgres reject malformed ranges at write time.
    accessMode: accessMode('access_mode').notNull().default('IP_ALLOWLIST'),
    venueCidrs: cidr('venue_cidrs')
      .array()
      .notNull()
      .default(sql`'{}'::cidr[]`),
    wifiSsid: text('wifi_ssid'),
    wifiPassword: text('wifi_password'),

    // Blind Hour (ADR-003).
    resultsVisibility: resultsVisibility('results_visibility').notNull().default('LIVE'),
    frozenSnapshot: jsonb('frozen_snapshot'),
    frozenAt: timestamp('frozen_at', { withTimezone: true }),

    // Phone / OTP policy.
    allowedPhonePrefixes: text('allowed_phone_prefixes')
      .array()
      .notNull()
      .default(sql`'{+9627}'::text[]`),
    otpTtlSeconds: integer('otp_ttl_seconds').notNull().default(300),
    otpMaxAttempts: integer('otp_max_attempts').notNull().default(5),
    otpResendCooldownSeconds: integer('otp_resend_cooldown_seconds').notNull().default(60),
    consentVersion: text('consent_version').notNull().default('2026-10-v1'),

    // Optimistic concurrency for admin edits (two admins editing settings at once).
    version: integer('version').notNull().default(1),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('settings_singleton', sql`${t.id} = 1`),
    check(
      'settings_window_order',
      sql`${t.votingOpensAt} IS NULL OR ${t.votingClosesAt} IS NULL OR ${t.votingOpensAt} < ${t.votingClosesAt}`,
    ),
    check('settings_otp_ttl', sql`${t.otpTtlSeconds} BETWEEN 60 AND 900`),
    check('settings_otp_attempts', sql`${t.otpMaxAttempts} BETWEEN 1 AND 10`),
    check('settings_otp_cooldown', sql`${t.otpResendCooldownSeconds} BETWEEN 15 AND 600`),
    check(
      'settings_frozen_consistency',
      sql`${t.resultsVisibility} <> 'FROZEN' OR (${t.frozenSnapshot} IS NOT NULL AND ${t.frozenAt} IS NOT NULL)`,
    ),
  ],
);

/* ───────────────────────────── Catalog ───────────────────────────── */

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    nameEn: text('name_en').notNull(),
    nameAr: text('name_ar').notNull(),
    descriptionEn: text('description_en'),
    descriptionAr: text('description_ar'),
    color: text('color').notNull().default('#7f32d9'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('categories_slug_format', sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check('categories_color_hex', sql`${t.color} ~ '^#[0-9a-fA-F]{6}$'`),
    check(
      'categories_name_len',
      sql`char_length(${t.nameEn}) BETWEEN 1 AND 80 AND char_length(${t.nameAr}) BETWEEN 1 AND 80`,
    ),
  ],
);

export const exhibitors = pgTable(
  'exhibitors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nameEn: text('name_en').notNull(),
    nameAr: text('name_ar'),
    projectEn: text('project_en'),
    projectAr: text('project_ar'),
    descriptionEn: text('description_en'),
    descriptionAr: text('description_ar'),
    booth: text('booth'),
    photoKey: text('photo_key'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('exhibitors_name_len', sql`char_length(${t.nameEn}) BETWEEN 1 AND 120`),
    check(
      'exhibitors_description_len',
      sql`char_length(coalesce(${t.descriptionEn}, '')) <= 600 AND char_length(coalesce(${t.descriptionAr}, '')) <= 600`,
    ),
    // Storage keys are server-generated; never a path the client chose.
    check(
      'exhibitors_photo_key_format',
      sql`${t.photoKey} IS NULL OR ${t.photoKey} ~ '^[a-f0-9-]{36}\\.webp$'`,
    ),
  ],
);

/** An exhibitor may compete in several categories (F9). */
export const exhibitorCategories = pgTable(
  'exhibitor_categories',
  {
    exhibitorId: uuid('exhibitor_id')
      .notNull()
      .references(() => exhibitors.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.exhibitorId, t.categoryId] }),
    index('exhibitor_categories_category_idx').on(t.categoryId),
  ],
);

/* ───────────────────────────── Visitors & OTP ───────────────────────────── */

export const visitors = pgTable(
  'visitors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // AES-256-GCM, versioned envelope (lib/crypto.ts). Never stored in plaintext.
    nameEnc: text('name_enc').notNull(),
    phoneEnc: text('phone_enc').notNull(),
    // HMAC-SHA256(pepper, E.164) — deterministic, so it can be UNIQUE without revealing the number.
    phoneHash: text('phone_hash').notNull().unique(),
    voteConsentAt: timestamp('vote_consent_at', { withTimezone: true }).notNull(),
    outreachConsentAt: timestamp('outreach_consent_at', { withTimezone: true }),
    consentVersion: text('consent_version').notNull(),
    locale: text('locale').notNull().default('ar'),
    createdIp: inet('created_ip'),
    deviceId: text('device_id'),
    isBlocked: boolean('is_blocked').notNull().default(false),
    // Sessions issued at or before this instant are void (logout / admin force-sign-out).
    sessionsRevokedAt: timestamp('sessions_revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('visitors_phone_hash_format', sql`${t.phoneHash} ~ '^[a-f0-9]{64}$'`),
    check('visitors_locale', sql`${t.locale} IN ('ar', 'en')`),
    index('visitors_device_idx').on(t.deviceId),
  ],
);

export const otpChallenges = pgTable(
  'otp_challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phoneHash: text('phone_hash').notNull(),
    // HMAC of (challenge id + code): useless if leaked, and never logged.
    codeHash: text('code_hash').notNull(),
    // Registration submitted with the request; becomes a `visitors` row only once the code is verified.
    nameEnc: text('name_enc').notNull(),
    phoneEnc: text('phone_enc').notNull(),
    outreachConsent: boolean('outreach_consent').notNull().default(false),
    consentVersion: text('consent_version').notNull(),
    locale: text('locale').notNull().default('ar'),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    ip: inet('ip'),
    deviceId: text('device_id'),
    createdAt: createdAt(),
  },
  (t) => [
    index('otp_challenges_phone_created_idx').on(t.phoneHash, t.createdAt.desc()),
    index('otp_challenges_device_created_idx').on(t.deviceId, t.createdAt.desc()),
    check('otp_challenges_attempts_nonneg', sql`${t.attempts} >= 0`),
    check('otp_challenges_locale', sql`${t.locale} IN ('ar', 'en')`),
  ],
);

/** Demo SMS inbox (SMS_PROVIDER=demo-inbox): admin-visible outbox so the pitch needs no SMS vendor. */
export const smsOutbox = pgTable(
  'sms_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    toMasked: text('to_masked').notNull(),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('sms_outbox_created_idx').on(t.createdAt.desc())],
);

/* ───────────────────────────── Votes ───────────────────────────── */

export const votes = pgTable(
  'votes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    visitorId: uuid('visitor_id')
      .notNull()
      .references(() => visitors.id, { onDelete: 'restrict' }),
    categoryId: uuid('category_id').notNull(),
    exhibitorId: uuid('exhibitor_id').notNull(),
    clientIp: inet('client_ip'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('votes_one_per_category').on(t.visitorId, t.categoryId),
    foreignKey({
      name: 'votes_exhibitor_in_category_fk',
      columns: [t.exhibitorId, t.categoryId],
      foreignColumns: [exhibitorCategories.exhibitorId, exhibitorCategories.categoryId],
    }).onDelete('restrict'),
    // Leaderboard: GROUP BY category, exhibitor is an index-only scan.
    index('votes_category_exhibitor_idx').on(t.categoryId, t.exhibitorId),
  ],
);

/* ───────────────────────────── Admin ───────────────────────────── */

export const adminUsers = pgTable(
  'admin_users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: text('username').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    role: adminRole('role').notNull().default('ADMIN'),
    totpSecretEnc: text('totp_secret_enc'),
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    isDisabled: boolean('is_disabled').notNull().default(false),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check('admin_users_username_format', sql`${t.username} ~ '^[a-z0-9._-]{3,32}$'`)],
);

export const adminRecoveryCodes = pgTable(
  'admin_recovery_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('admin_recovery_codes_admin_idx').on(t.adminId)],
);

export const adminSessions = pgTable(
  'admin_sessions',
  {
    // SHA-256 of the opaque cookie token — a DB leak does not yield usable sessions.
    tokenHash: text('token_hash').primaryKey(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    csrfSecret: text('csrf_secret').notNull(),
    mfaVerified: boolean('mfa_verified').notNull().default(false),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('admin_sessions_admin_idx').on(t.adminId),
    index('admin_sessions_expires_idx').on(t.expiresAt),
  ],
);

/** TV displays authenticate with a revocable token (read-only, no PII). */
export const displayTokens = pgTable('display_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  label: text('label').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  createdBy: uuid('created_by').references(() => adminUsers.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

/** Append-only (UPDATE/DELETE blocked by trigger, see custom migration). */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    // RESTRICT (not SET NULL): SET NULL would UPDATE append-only rows. Admins are disabled, never deleted.
    actorAdminId: uuid('actor_admin_id').references(() => adminUsers.id, { onDelete: 'restrict' }),
    actorLabel: text('actor_label').notNull(),
    action: text('action').notNull(),
    entity: text('entity'),
    entityId: text('entity_id'),
    details: jsonb('details'),
    ip: inet('ip'),
  },
  (t) => [
    index('audit_log_at_idx').on(t.at.desc()),
    index('audit_log_entity_idx').on(t.entity, t.entityId),
  ],
);
