-- 073-B (D1, D4, D6): Humano↔Bot, anti-flood y opt-out (Ley 1581). Aditiva y
-- re-ejecutable: solo columnas nuevas, todas nulables, y el CHECK de
-- `bot_incident.kind` crece con `abuso` (las filas existentes siguen valiendo).
ALTER TABLE "bot_incident" DROP CONSTRAINT IF EXISTS "bot_incident_kind_ck";--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "opt_out_at" timestamp;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "opt_out_source" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "ai_paused_at" timestamp;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "human_gap_from" timestamp;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "human_gap_to" timestamp;--> statement-breakpoint
ALTER TABLE "bot_incident" ADD CONSTRAINT "bot_incident_kind_ck" CHECK ("bot_incident"."kind" in ('despacho_caducado', 'sin_saldo', 'sin_credencial', 'envio_permanente', 'abuso'));
