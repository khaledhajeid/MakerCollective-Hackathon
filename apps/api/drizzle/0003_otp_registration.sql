-- OTP challenges now carry the registration the visitor submitted (name, phone, consents) so the
-- identity row is created only after the phone is PROVEN. Challenges are ephemeral (minutes),
-- so clearing the table before adding NOT NULL columns is safe.
DELETE FROM "otp_challenges";--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD COLUMN "name_enc" text NOT NULL;--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD COLUMN "phone_enc" text NOT NULL;--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD COLUMN "outreach_consent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD COLUMN "consent_version" text NOT NULL;--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD COLUMN "locale" text DEFAULT 'ar' NOT NULL;--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_locale" CHECK ("otp_challenges"."locale" IN ('ar', 'en'));