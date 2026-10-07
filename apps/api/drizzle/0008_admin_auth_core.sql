ALTER TABLE "admin_users" ADD COLUMN "totp_last_step" bigint;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "credentials_expire_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "password_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "admin_recovery_codes" ADD CONSTRAINT "admin_recovery_codes_admin_hash_uq" UNIQUE("admin_id","code_hash");--> statement-breakpoint
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_mfa_has_secret" CHECK ("admin_users"."mfa_enabled" = false OR "admin_users"."totp_secret_enc" IS NOT NULL);