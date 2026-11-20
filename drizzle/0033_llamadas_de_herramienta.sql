-- 072-B (B2, D14, D21): idempotencia del puente de herramientas de módulo
-- (`POST /api/brains/tools/{name}`). Tabla nueva, aditiva y re-ejecutable:
-- ninguna tabla existente cambia. Se purga a los 30 días.
CREATE TABLE IF NOT EXISTS "brain_tool_call" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"dispatch_id" text NOT NULL,
	"tool" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"estado" text NOT NULL,
	"response" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brain_tool_call" DROP CONSTRAINT IF EXISTS "brain_tool_call_estado_ck";--> statement-breakpoint
ALTER TABLE "brain_tool_call" ADD CONSTRAINT "brain_tool_call_estado_ck" CHECK ("brain_tool_call"."estado" in ('en_curso', 'hecha', 'fallida'));--> statement-breakpoint
ALTER TABLE "brain_tool_call" DROP CONSTRAINT IF EXISTS "brain_tool_call_organization_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "brain_tool_call" ADD CONSTRAINT "brain_tool_call_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_tool_call" DROP CONSTRAINT IF EXISTS "brain_tool_call_conversation_id_conversation_id_fk";--> statement-breakpoint
ALTER TABLE "brain_tool_call" ADD CONSTRAINT "brain_tool_call_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "brain_tool_call_idem_uq" ON "brain_tool_call" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brain_tool_call_created_idx" ON "brain_tool_call" USING btree ("created_at");
