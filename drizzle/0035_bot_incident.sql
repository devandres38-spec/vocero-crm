-- 073-A (D3, D10): incidentes del bot. Tabla nueva, aditiva y re-ejecutable:
-- ninguna tabla existente cambia. Una fila por (organización, dedupe_key);
-- un incidente que se repite suma `count`. Se purga a los 90 días.
CREATE TABLE IF NOT EXISTS "bot_incident" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text,
	"kind" text NOT NULL,
	"detail" text,
	"count" integer DEFAULT 1 NOT NULL,
	"dedupe_key" text NOT NULL,
	"first_at" timestamp DEFAULT now() NOT NULL,
	"last_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_incident" DROP CONSTRAINT IF EXISTS "bot_incident_kind_ck";--> statement-breakpoint
ALTER TABLE "bot_incident" ADD CONSTRAINT "bot_incident_kind_ck" CHECK ("bot_incident"."kind" in ('despacho_caducado', 'sin_saldo', 'sin_credencial', 'envio_permanente'));--> statement-breakpoint
ALTER TABLE "bot_incident" DROP CONSTRAINT IF EXISTS "bot_incident_organization_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "bot_incident" ADD CONSTRAINT "bot_incident_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_incident" DROP CONSTRAINT IF EXISTS "bot_incident_conversation_id_conversation_id_fk";--> statement-breakpoint
ALTER TABLE "bot_incident" ADD CONSTRAINT "bot_incident_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bot_incident_dedupe_uq" ON "bot_incident" USING btree ("organization_id","dedupe_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bot_incident_last_idx" ON "bot_incident" USING btree ("last_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bot_incident_conv_idx" ON "bot_incident" USING btree ("conversation_id");
