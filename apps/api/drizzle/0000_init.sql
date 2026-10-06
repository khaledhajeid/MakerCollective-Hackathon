CREATE TYPE "public"."access_mode" AS ENUM('IP_ALLOWLIST', 'OFF');--> statement-breakpoint
CREATE TYPE "public"."admin_role" AS ENUM('SUPER_ADMIN', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."results_visibility" AS ENUM('LIVE', 'FROZEN', 'HIDDEN', 'REVEAL');--> statement-breakpoint
CREATE TYPE "public"."voting_status" AS ENUM('SCHEDULED', 'OPEN', 'CLOSED');--> statement-breakpoint
CREATE TABLE "admin_recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"admin_id" uuid NOT NULL,
	"csrf_secret" text NOT NULL,
	"mfa_verified" boolean DEFAULT false NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "admin_role" DEFAULT 'ADMIN' NOT NULL,
	"totp_secret_enc" text,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"is_disabled" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_username_unique" UNIQUE("username"),
	CONSTRAINT "admin_users_username_format" CHECK ("admin_users"."username" ~ '^[a-z0-9._-]{3,32}$')
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_admin_id" uuid,
	"actor_label" text NOT NULL,
	"action" text NOT NULL,
	"entity" text,
	"entity_id" text,
	"details" jsonb,
	"ip" "inet"
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"description_en" text,
	"description_ar" text,
	"color" text DEFAULT '#7f32d9' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug"),
	CONSTRAINT "categories_slug_format" CHECK ("categories"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "categories_color_hex" CHECK ("categories"."color" ~ '^#[0-9a-fA-F]{6}$'),
	CONSTRAINT "categories_name_len" CHECK (char_length("categories"."name_en") BETWEEN 1 AND 80 AND char_length("categories"."name_ar") BETWEEN 1 AND 80)
);
--> statement-breakpoint
CREATE TABLE "display_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "display_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "exhibitor_categories" (
	"exhibitor_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "exhibitor_categories_exhibitor_id_category_id_pk" PRIMARY KEY("exhibitor_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "exhibitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text,
	"project_en" text,
	"project_ar" text,
	"description_en" text,
	"description_ar" text,
	"booth" text,
	"photo_key" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exhibitors_name_len" CHECK (char_length("exhibitors"."name_en") BETWEEN 1 AND 120),
	CONSTRAINT "exhibitors_description_len" CHECK (char_length(coalesce("exhibitors"."description_en", '')) <= 600 AND char_length(coalesce("exhibitors"."description_ar", '')) <= 600),
	CONSTRAINT "exhibitors_photo_key_format" CHECK ("exhibitors"."photo_key" IS NULL OR "exhibitors"."photo_key" ~ '^[a-f0-9-]{36}\.webp$')
);
--> statement-breakpoint
CREATE TABLE "otp_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_hash" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"ip" "inet",
	"device_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "otp_challenges_attempts_nonneg" CHECK ("otp_challenges"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"event_name" text DEFAULT 'The Maker Collective 2026' NOT NULL,
	"voting_status" "voting_status" DEFAULT 'SCHEDULED' NOT NULL,
	"voting_opens_at" timestamp with time zone,
	"voting_closes_at" timestamp with time zone,
	"access_mode" "access_mode" DEFAULT 'IP_ALLOWLIST' NOT NULL,
	"venue_cidrs" "cidr"[] DEFAULT '{}'::cidr[] NOT NULL,
	"wifi_ssid" text,
	"wifi_password" text,
	"results_visibility" "results_visibility" DEFAULT 'LIVE' NOT NULL,
	"frozen_snapshot" jsonb,
	"frozen_at" timestamp with time zone,
	"allowed_phone_prefixes" text[] DEFAULT '{+9627}'::text[] NOT NULL,
	"otp_ttl_seconds" integer DEFAULT 300 NOT NULL,
	"otp_max_attempts" integer DEFAULT 5 NOT NULL,
	"otp_resend_cooldown_seconds" integer DEFAULT 60 NOT NULL,
	"consent_version" text DEFAULT '2026-10-v1' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_singleton" CHECK ("settings"."id" = 1),
	CONSTRAINT "settings_window_order" CHECK ("settings"."voting_opens_at" IS NULL OR "settings"."voting_closes_at" IS NULL OR "settings"."voting_opens_at" < "settings"."voting_closes_at"),
	CONSTRAINT "settings_otp_ttl" CHECK ("settings"."otp_ttl_seconds" BETWEEN 60 AND 900),
	CONSTRAINT "settings_otp_attempts" CHECK ("settings"."otp_max_attempts" BETWEEN 1 AND 10),
	CONSTRAINT "settings_otp_cooldown" CHECK ("settings"."otp_resend_cooldown_seconds" BETWEEN 15 AND 600),
	CONSTRAINT "settings_frozen_consistency" CHECK ("settings"."results_visibility" <> 'FROZEN' OR ("settings"."frozen_snapshot" IS NOT NULL AND "settings"."frozen_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "sms_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"to_masked" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name_enc" text NOT NULL,
	"phone_enc" text NOT NULL,
	"phone_hash" text NOT NULL,
	"vote_consent_at" timestamp with time zone NOT NULL,
	"outreach_consent_at" timestamp with time zone,
	"consent_version" text NOT NULL,
	"locale" text DEFAULT 'ar' NOT NULL,
	"created_ip" "inet",
	"device_id" text,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visitors_phone_hash_unique" UNIQUE("phone_hash"),
	CONSTRAINT "visitors_phone_hash_format" CHECK ("visitors"."phone_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "visitors_locale" CHECK ("visitors"."locale" IN ('ar', 'en'))
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visitor_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"exhibitor_id" uuid NOT NULL,
	"client_ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "votes_one_per_category" UNIQUE("visitor_id","category_id")
);
--> statement-breakpoint
ALTER TABLE "admin_recovery_codes" ADD CONSTRAINT "admin_recovery_codes_admin_id_admin_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_id_admin_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_admin_id_admin_users_id_fk" FOREIGN KEY ("actor_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "display_tokens" ADD CONSTRAINT "display_tokens_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exhibitor_categories" ADD CONSTRAINT "exhibitor_categories_exhibitor_id_exhibitors_id_fk" FOREIGN KEY ("exhibitor_id") REFERENCES "public"."exhibitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exhibitor_categories" ADD CONSTRAINT "exhibitor_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_visitor_id_visitors_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "public"."visitors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_exhibitor_in_category_fk" FOREIGN KEY ("exhibitor_id","category_id") REFERENCES "public"."exhibitor_categories"("exhibitor_id","category_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_recovery_codes_admin_idx" ON "admin_recovery_codes" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "admin_sessions_admin_idx" ON "admin_sessions" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "admin_sessions_expires_idx" ON "admin_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "exhibitor_categories_category_idx" ON "exhibitor_categories" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "otp_challenges_phone_created_idx" ON "otp_challenges" USING btree ("phone_hash","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "otp_challenges_device_created_idx" ON "otp_challenges" USING btree ("device_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sms_outbox_created_idx" ON "sms_outbox" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "visitors_device_idx" ON "visitors" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "votes_category_exhibitor_idx" ON "votes" USING btree ("category_id","exhibitor_id");