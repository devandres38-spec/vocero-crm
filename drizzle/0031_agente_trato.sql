-- 071: cómo trata el agente a los clientes y si cierra las conversaciones sin
-- rumbo. Aditiva y re-ejecutable; con DEFAULT constante, en PG 16 es solo de
-- metadatos (no reescribe la tabla).
ALTER TABLE "agent_profile" ADD COLUMN IF NOT EXISTS "treatment" text DEFAULT 'tu' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN IF NOT EXISTS "stall_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_profile" DROP CONSTRAINT IF EXISTS "agent_profile_treatment_ck";--> statement-breakpoint
ALTER TABLE "agent_profile" ADD CONSTRAINT "agent_profile_treatment_ck" CHECK ("agent_profile"."treatment" in ('tu', 'usted', 'neutro'));
