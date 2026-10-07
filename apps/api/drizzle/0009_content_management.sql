CREATE TABLE "exhibitor_photos" (
	"key" text PRIMARY KEY NOT NULL,
	"data" "bytea" NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exhibitor_photos_key_format" CHECK ("exhibitor_photos"."key" ~ '^[a-f0-9-]{36}\.webp$'),
	CONSTRAINT "exhibitor_photos_size" CHECK (octet_length("exhibitor_photos"."data") BETWEEN 1 AND 358400)
);
--> statement-breakpoint
ALTER TABLE "exhibitors" ADD CONSTRAINT "exhibitors_photo_key_exhibitor_photos_key_fk" FOREIGN KEY ("photo_key") REFERENCES "public"."exhibitor_photos"("key") ON DELETE set null ON UPDATE no action;