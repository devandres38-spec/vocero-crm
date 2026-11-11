CREATE TABLE "consent" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"conversation_id" text,
	"kind" text NOT NULL,
	"granted" boolean NOT NULL,
	"notice_version" text NOT NULL,
	"source_message_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "consent_kind_chk" CHECK ("consent"."kind" in ('aviso_privacidad', 'marketing')),
	CONSTRAINT "consent_notice_version_chk" CHECK (char_length("consent"."notice_version") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "olvido_pendiente" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"evento" jsonb NOT NULL,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"not_before" timestamp DEFAULT now() NOT NULL,
	"leased_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "olvido_pendiente_status_chk" CHECK ("olvido_pendiente"."status" in ('pendiente', 'agotado'))
);
--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "button_id" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "buttons" jsonb;--> statement-breakpoint
ALTER TABLE "privacy_profile" ADD COLUMN "adjuntos" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "consent" ADD CONSTRAINT "consent_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent" ADD CONSTRAINT "consent_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent" ADD CONSTRAINT "consent_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "olvido_pendiente" ADD CONSTRAINT "olvido_pendiente_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_org_contact_kind_idx" ON "consent" USING btree ("organization_id","contact_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "consent_org_conv_kind_idx" ON "consent" USING btree ("organization_id","conversation_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "olvido_pendiente_vivo_idx" ON "olvido_pendiente" USING btree ("not_before") WHERE "olvido_pendiente"."status" = 'pendiente';--> statement-breakpoint
-- 070 D1: los perfiles sin filtro de salud guardan adjuntos; los demás, no.
UPDATE "privacy_profile" SET "adjuntos" = true WHERE "sensitive_terms" IS NULL;