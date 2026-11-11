-- 075 (bloque H, D15 de Aliantis) — RLS en Vocero. Escrita a mano (drizzle-kit no la genera).
--
-- La aplicación se conecta con un usuario miembro de vocero_app: sin BYPASSRLS, sin ser superusuario
-- y sin ser dueño de las tablas (el dueño es el rol de migraciones, DATABASE_MIGRATIONS_URL). Cada
-- consulta fija el negocio dentro de su transacción con set_config('app.organization_id', <id>, true)
-- (src/lib/db/cliente-rls.ts). Sin ese valor (NULL, o '' si ya se definió en la sesión), no se ve
-- ni se escribe nada.
--
-- Sin FORCE ROW LEVEL SECURITY: el dueño se salta RLS, y así pueden hacerlo las funciones
-- SECURITY DEFINER de abajo, que solo devuelven ids o conteos para que los procesos de fondo
-- descubran su trabajo. La app nunca se conecta como dueño: si lo hace, no arranca en producción.
--
-- user, session, account y verification quedan SIN RLS a propósito: no tienen organization_id y
-- Better Auth las lee antes de saber el negocio (iniciar sesión es buscar un usuario por correo).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vocero_app') THEN
    CREATE ROLE vocero_app NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "public" TO vocero_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "public" TO vocero_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA "public" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vocero_app;
--> statement-breakpoint
-- El negocio mismo: un negocio no ve el nombre, la marca ni la apariencia de otro.
ALTER TABLE "organization" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "organization_por_negocio" ON "organization";
--> statement-breakpoint
CREATE POLICY "organization_por_negocio" ON "organization"
  USING ("id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "member" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "member_por_negocio" ON "member";
--> statement-breakpoint
CREATE POLICY "member_por_negocio" ON "member"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "invitation" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "invitation_por_negocio" ON "invitation";
--> statement-breakpoint
CREATE POLICY "invitation_por_negocio" ON "invitation"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "contact" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "contact_por_negocio" ON "contact";
--> statement-breakpoint
CREATE POLICY "contact_por_negocio" ON "contact"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "pipeline_stage" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "pipeline_stage_por_negocio" ON "pipeline_stage";
--> statement-breakpoint
CREATE POLICY "pipeline_stage_por_negocio" ON "pipeline_stage"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "lead" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "lead_por_negocio" ON "lead";
--> statement-breakpoint
CREATE POLICY "lead_por_negocio" ON "lead"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "lead_stage_event" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "lead_stage_event_por_negocio" ON "lead_stage_event";
--> statement-breakpoint
CREATE POLICY "lead_stage_event_por_negocio" ON "lead_stage_event"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "conversation" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "conversation_por_negocio" ON "conversation";
--> statement-breakpoint
CREATE POLICY "conversation_por_negocio" ON "conversation"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "message" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "message_por_negocio" ON "message";
--> statement-breakpoint
CREATE POLICY "message_por_negocio" ON "message"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "media_asset" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "media_asset_por_negocio" ON "media_asset";
--> statement-breakpoint
CREATE POLICY "media_asset_por_negocio" ON "media_asset"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "meta_credentials" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "meta_credentials_por_negocio" ON "meta_credentials";
--> statement-breakpoint
CREATE POLICY "meta_credentials_por_negocio" ON "meta_credentials"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "meta_app" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "meta_app_por_negocio" ON "meta_app";
--> statement-breakpoint
CREATE POLICY "meta_app_por_negocio" ON "meta_app"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "instagram_credentials" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "instagram_credentials_por_negocio" ON "instagram_credentials";
--> statement-breakpoint
CREATE POLICY "instagram_credentials_por_negocio" ON "instagram_credentials"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "messenger_credentials" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "messenger_credentials_por_negocio" ON "messenger_credentials";
--> statement-breakpoint
CREATE POLICY "messenger_credentials_por_negocio" ON "messenger_credentials"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "tiktok_credentials" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tiktok_credentials_por_negocio" ON "tiktok_credentials";
--> statement-breakpoint
CREATE POLICY "tiktok_credentials_por_negocio" ON "tiktok_credentials"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "agent_profile" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "agent_profile_por_negocio" ON "agent_profile";
--> statement-breakpoint
CREATE POLICY "agent_profile_por_negocio" ON "agent_profile"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "kb_entry" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "kb_entry_por_negocio" ON "kb_entry";
--> statement-breakpoint
CREATE POLICY "kb_entry_por_negocio" ON "kb_entry"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "template" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "template_por_negocio" ON "template";
--> statement-breakpoint
CREATE POLICY "template_por_negocio" ON "template"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "agent_test_run" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "agent_test_run_por_negocio" ON "agent_test_run";
--> statement-breakpoint
CREATE POLICY "agent_test_run_por_negocio" ON "agent_test_run"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "calendar_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "calendar_settings_por_negocio" ON "calendar_settings";
--> statement-breakpoint
CREATE POLICY "calendar_settings_por_negocio" ON "calendar_settings"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "booking" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "booking_por_negocio" ON "booking";
--> statement-breakpoint
CREATE POLICY "booking_por_negocio" ON "booking"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "offered_slot" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "offered_slot_por_negocio" ON "offered_slot";
--> statement-breakpoint
CREATE POLICY "offered_slot_por_negocio" ON "offered_slot"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "zoom_credentials" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "zoom_credentials_por_negocio" ON "zoom_credentials";
--> statement-breakpoint
CREATE POLICY "zoom_credentials_por_negocio" ON "zoom_credentials"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "google_credentials" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "google_credentials_por_negocio" ON "google_credentials";
--> statement-breakpoint
CREATE POLICY "google_credentials_por_negocio" ON "google_credentials"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "agent_test_case" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "agent_test_case_por_negocio" ON "agent_test_case";
--> statement-breakpoint
CREATE POLICY "agent_test_case_por_negocio" ON "agent_test_case"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "ad_attribution" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "ad_attribution_por_negocio" ON "ad_attribution";
--> statement-breakpoint
CREATE POLICY "ad_attribution_por_negocio" ON "ad_attribution"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "conversion_event" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "conversion_event_por_negocio" ON "conversion_event";
--> statement-breakpoint
CREATE POLICY "conversion_event_por_negocio" ON "conversion_event"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "capi_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "capi_settings_por_negocio" ON "capi_settings";
--> statement-breakpoint
CREATE POLICY "capi_settings_por_negocio" ON "capi_settings"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "ai_credentials" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "ai_credentials_por_negocio" ON "ai_credentials";
--> statement-breakpoint
CREATE POLICY "ai_credentials_por_negocio" ON "ai_credentials"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "dispatch" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "dispatch_por_negocio" ON "dispatch";
--> statement-breakpoint
CREATE POLICY "dispatch_por_negocio" ON "dispatch"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "webhook_event" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "webhook_event_por_negocio" ON "webhook_event";
--> statement-breakpoint
CREATE POLICY "webhook_event_por_negocio" ON "webhook_event"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "quick_reply" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "quick_reply_por_negocio" ON "quick_reply";
--> statement-breakpoint
CREATE POLICY "quick_reply_por_negocio" ON "quick_reply"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "conversation_note" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "conversation_note_por_negocio" ON "conversation_note";
--> statement-breakpoint
CREATE POLICY "conversation_note_por_negocio" ON "conversation_note"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "privacy_profile" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "privacy_profile_por_negocio" ON "privacy_profile";
--> statement-breakpoint
CREATE POLICY "privacy_profile_por_negocio" ON "privacy_profile"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "consent" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "consent_por_negocio" ON "consent";
--> statement-breakpoint
CREATE POLICY "consent_por_negocio" ON "consent"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "olvido_pendiente" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "olvido_pendiente_por_negocio" ON "olvido_pendiente";
--> statement-breakpoint
CREATE POLICY "olvido_pendiente_por_negocio" ON "olvido_pendiente"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "aviso_canal" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "aviso_canal_por_negocio" ON "aviso_canal";
--> statement-breakpoint
CREATE POLICY "aviso_canal_por_negocio" ON "aviso_canal"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
ALTER TABLE "aviso_traspaso" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "aviso_traspaso_por_negocio" ON "aviso_traspaso";
--> statement-breakpoint
CREATE POLICY "aviso_traspaso_por_negocio" ON "aviso_traspaso"
  USING ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.organization_id', true), ''));
--> statement-breakpoint
-- ============================================================
-- Funciones SECURITY DEFINER: SOLO ids, un rol o conteos, nunca contenido. Corren como su dueño
-- (el rol de migraciones, que se salta RLS) para lo que pasa antes de saber el negocio o sobre
-- varios: la sesión, el webhook entrante y el descubrimiento de trabajo de los procesos de fondo.
-- Todo lo demás (leer o escribir datos) ocurre dentro de conNegocio, con RLS.
-- Cada una: search_path fijo, sin EXECUTE para PUBLIC y solo para vocero_app.
-- ============================================================
CREATE OR REPLACE FUNCTION vocero_membresia(p_user_id text)
RETURNS TABLE (organization_id text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT m.organization_id, m.role FROM member m
  WHERE m.user_id = p_user_id
  ORDER BY m.created_at, m.id
  LIMIT 1
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION vocero_organizacion_existe(p_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM organization WHERE id = p_id)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION vocero_hasta_dos_organizaciones()
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT coalesce(array_agg(o.id), '{}') FROM (SELECT id FROM organization ORDER BY id LIMIT 2) o
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION vocero_organizaciones()
RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT id FROM organization ORDER BY created_at, id
$$;
--> statement-breakpoint
-- El negocio de un webhook entrante, por la clave que trae (las mismas búsquedas que hacía la app).
CREATE OR REPLACE FUNCTION vocero_negocio_por_canal(p_tipo text, p_clave text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT CASE p_tipo
    WHEN 'phone_number_id' THEN
      (SELECT organization_id FROM meta_credentials WHERE phone_number_id = p_clave LIMIT 1)
    WHEN 'waba_id' THEN
      (SELECT organization_id FROM meta_credentials
        WHERE waba_id = p_clave OR messaging_account_id = p_clave LIMIT 1)
    WHEN 'ig_user_id' THEN
      (SELECT organization_id FROM instagram_credentials WHERE ig_user_id = p_clave LIMIT 1)
    WHEN 'page_id' THEN
      (SELECT organization_id FROM messenger_credentials WHERE page_id = p_clave LIMIT 1)
    WHEN 'zernio:instagram' THEN
      (SELECT organization_id FROM instagram_credentials
        WHERE source = 'zernio' AND account_ref = p_clave LIMIT 1)
    WHEN 'zernio:messenger' THEN
      (SELECT organization_id FROM messenger_credentials
        WHERE source = 'zernio' AND account_ref = p_clave LIMIT 1)
    WHEN 'zernio:tiktok' THEN
      (SELECT organization_id FROM tiktok_credentials WHERE account_ref = p_clave LIMIT 1)
  END
$$;
--> statement-breakpoint
-- Despacho: los más viejos listos para tomarse (con el reparto justo del bloque G: `p_excluir`).
CREATE OR REPLACE FUNCTION vocero_despachos_vencidos(p_ahora timestamp, p_limite integer, p_excluir text[])
RETURNS TABLE (id text, organization_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT d.id, d.organization_id FROM dispatch d
  WHERE ((d.status = 'pendiente' AND d.not_before <= p_ahora)
      OR (d.status = 'en_vuelo' AND d.leased_until <= p_ahora))
    AND NOT (d.organization_id = ANY (coalesce(p_excluir, '{}')))
  ORDER BY d.not_before
  LIMIT p_limite
$$;
--> statement-breakpoint
-- Webhooks: los eventos listos para procesarse.
CREATE OR REPLACE FUNCTION vocero_eventos_pendientes(p_ahora timestamp, p_limite integer)
RETURNS TABLE (id text, organization_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT e.id, e.organization_id FROM webhook_event e
  WHERE (e.status = 'pendiente' AND e.not_before <= p_ahora)
     OR (e.status = 'en_proceso' AND e.leased_until <= p_ahora)
  ORDER BY e.not_before
  LIMIT p_limite
$$;
--> statement-breakpoint
-- Webhooks: los negocios con eventos para purgar (se borran después, dentro de cada negocio).
CREATE OR REPLACE FUNCTION vocero_negocios_con_eventos_viejos(p_corte_procesado timestamp, p_corte_agotado timestamp)
RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT e.organization_id FROM webhook_event e
  WHERE (e.status = 'procesado' AND e.updated_at < p_corte_procesado)
     OR (e.status = 'agotado' AND e.updated_at < p_corte_agotado)
$$;
--> statement-breakpoint
-- /api/health: solo números de toda la instalación.
CREATE OR REPLACE FUNCTION vocero_conteo_webhooks()
RETURNS TABLE (pendientes bigint, agotados bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT count(*) FILTER (WHERE status IN ('pendiente', 'en_proceso')),
         count(*) FILTER (WHERE status = 'agotado')
  FROM webhook_event
$$;
--> statement-breakpoint
-- Olvidos: los negocios con avisos de olvido por reintentar.
CREATE OR REPLACE FUNCTION vocero_negocios_con_olvidos(p_ahora timestamp)
RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT o.organization_id FROM olvido_pendiente o
  WHERE o.status = 'pendiente' AND o.not_before <= p_ahora
    AND (o.leased_until IS NULL OR o.leased_until < p_ahora)
$$;
--> statement-breakpoint
-- Avisos por Telegram: los negocios con avisos pendientes.
CREATE OR REPLACE FUNCTION vocero_negocios_con_avisos()
RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT a.organization_id FROM aviso_traspaso a WHERE a.status = 'pendiente'
$$;
--> statement-breakpoint
-- Alta (crearNegocio): los slugs ya usados, para elegir uno libre.
CREATE OR REPLACE FUNCTION vocero_slugs_ocupados(p_base text)
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT coalesce(array_agg(slug), '{}') FROM organization
  WHERE slug = p_base OR slug LIKE p_base || '-%'
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION
  vocero_membresia(text), vocero_organizacion_existe(text), vocero_hasta_dos_organizaciones(),
  vocero_organizaciones(), vocero_negocio_por_canal(text, text),
  vocero_despachos_vencidos(timestamp, integer, text[]), vocero_eventos_pendientes(timestamp, integer),
  vocero_negocios_con_eventos_viejos(timestamp, timestamp), vocero_conteo_webhooks(),
  vocero_negocios_con_olvidos(timestamp), vocero_negocios_con_avisos(), vocero_slugs_ocupados(text)
  FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  vocero_membresia(text), vocero_organizacion_existe(text), vocero_hasta_dos_organizaciones(),
  vocero_organizaciones(), vocero_negocio_por_canal(text, text),
  vocero_despachos_vencidos(timestamp, integer, text[]), vocero_eventos_pendientes(timestamp, integer),
  vocero_negocios_con_eventos_viejos(timestamp, timestamp), vocero_conteo_webhooks(),
  vocero_negocios_con_olvidos(timestamp), vocero_negocios_con_avisos(), vocero_slugs_ocupados(text)
  TO vocero_app;
