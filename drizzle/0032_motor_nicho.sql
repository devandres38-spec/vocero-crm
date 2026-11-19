-- 072 (A1): Motor Multi-Nicho — el Vertical Pack del negocio, sus ajustes
-- (solo datos) y el esquema de su ficha. Aditiva y re-ejecutable; con DEFAULT
-- constante, en PG 16 es solo de metadatos (no reescribe la tabla). Todos los
-- negocios existentes quedan en `default` y sin esquema: lo de 2.11.0.
ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "vertical_pack" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "vertical_overrides" jsonb;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "ficha_fields" jsonb;--> statement-breakpoint
ALTER TABLE "organization" DROP CONSTRAINT IF EXISTS "organization_vertical_pack_ck";--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_vertical_pack_ck" CHECK ("organization"."vertical_pack" ~ '^[a-z][a-z0-9-]{1,39}$');--> statement-breakpoint
ALTER TABLE "organization" DROP CONSTRAINT IF EXISTS "organization_vertical_overrides_tam_ck";--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_vertical_overrides_tam_ck" CHECK ("organization"."vertical_overrides" is null or pg_column_size("organization"."vertical_overrides") < 8192);--> statement-breakpoint
ALTER TABLE "organization" DROP CONSTRAINT IF EXISTS "organization_ficha_fields_tam_ck";--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_ficha_fields_tam_ck" CHECK ("organization"."ficha_fields" is null or pg_column_size("organization"."ficha_fields") < 16384);
