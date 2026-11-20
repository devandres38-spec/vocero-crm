-- 074 (D8, D9): KB de producción, enlaces verificados, cupo de «Probar mi
-- agente» y uso del modelo (BYOK). Aditiva y re-ejecutable: tablas y columnas
-- nuevas con IF NOT EXISTS, columnas con default (las filas existentes quedan
-- activas, sin fijar, categoría `general`), y los CHECK/FK se quitan y se
-- vuelven a poner.
CREATE TABLE IF NOT EXISTS "agent_playground_day" (
	"organization_id" text NOT NULL,
	"day" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_playground_day_organization_id_day_pk" PRIMARY KEY("organization_id","day")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "llm_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"dispatch_id" text,
	"source" text NOT NULL,
	"model" text,
	"status_code" integer NOT NULL,
	"prompt_tokens" integer,
	"cached_tokens" integer,
	"completion_tokens" integer,
	"latency_ms" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "llm_usage" DROP CONSTRAINT IF EXISTS "llm_usage_source_ck";--> statement-breakpoint
ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_source_ck" CHECK ("llm_usage"."source" in ('turn', 'ensayo', 'lab', 'transcribe'));--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN IF NOT EXISTS "resources" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "kb_entry" ADD COLUMN IF NOT EXISTS "title" text;--> statement-breakpoint
ALTER TABLE "kb_entry" ADD COLUMN IF NOT EXISTS "category" text DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "kb_entry" ADD COLUMN IF NOT EXISTS "enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "kb_entry" ADD COLUMN IF NOT EXISTS "pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "kb_entry" ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_playground_day" DROP CONSTRAINT IF EXISTS "agent_playground_day_organization_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "agent_playground_day" ADD CONSTRAINT "agent_playground_day_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_usage" DROP CONSTRAINT IF EXISTS "llm_usage_organization_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_usage_org_created_idx" ON "llm_usage" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_usage_created_idx" ON "llm_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_org_orden_idx" ON "kb_entry" USING btree ("organization_id","enabled","pinned","sort_order");--> statement-breakpoint
ALTER TABLE "kb_entry" DROP CONSTRAINT IF EXISTS "kb_entry_category_ck";--> statement-breakpoint
ALTER TABLE "kb_entry" ADD CONSTRAINT "kb_entry_category_ck" CHECK ("kb_entry"."category" in ('general', 'servicios', 'precios', 'horarios', 'pagos', 'politicas', 'faq'));
