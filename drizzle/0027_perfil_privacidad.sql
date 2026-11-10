CREATE TABLE "privacy_profile" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"profile_name" text NOT NULL,
	"profile_version" integer NOT NULL,
	"country" text NOT NULL,
	"sensitive_terms" jsonb,
	"allowlist" text[] DEFAULT '{}'::text[] NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_profile_country_chk" CHECK (char_length("privacy_profile"."country") = 2)
);
--> statement-breakpoint
ALTER TABLE "privacy_profile" ADD CONSTRAINT "privacy_profile_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_profile_org_uq" ON "privacy_profile" USING btree ("organization_id");