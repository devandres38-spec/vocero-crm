-- 079 (bloque K, 5.5 de Aliantis) — «Solo estos números» (piloto) en el perfil del Agente.
-- La generó drizzle-kit desde schema.ts: queda bajo la RLS de agent_profile (0033).
ALTER TABLE "agent_profile" ADD COLUMN "solo_numeros_activo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN "solo_numeros" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD CONSTRAINT "agent_profile_solo_numeros_max_chk" CHECK (cardinality("agent_profile"."solo_numeros") <= 50);