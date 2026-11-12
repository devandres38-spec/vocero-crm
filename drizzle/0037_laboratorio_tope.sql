-- 080 (bloque L, D20 y D3 de Aliantis) — El tope diario del Laboratorio. Las dos primeras líneas
-- las generó drizzle-kit desde schema.ts; lo de abajo, desde el bloque marcado, va escrito a mano.
ALTER TABLE "organization" ADD COLUMN "lab_corridas_por_dia" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_lab_corridas_por_dia_chk" CHECK ("organization"."lab_corridas_por_dia" BETWEEN 0 AND 20);
--> statement-breakpoint
-- ===========================================================================================
-- 080 — Escrito a mano.
--
-- El tope y la pausa los escribe solo el panel de Andres. En Postgres, revocar UPDATE de una
-- columna no sirve si queda el permiso de tabla (0033 lo dio sobre todas): se quita el de tabla
-- y se devuelve solo en las columnas que la app cambia. Verificado en el código (12-nov-2026):
-- la app escribe `metadata` (Marca, src/server/branding.ts; Apariencia, src/server/apariencia.ts)
-- y Better Auth, al actualizar un negocio, `name`, `slug`, `logo` y `metadata`.
-- `lab_corridas_por_dia` y `pausado_en` (076) quedan fuera; las funciones vocero_panel_* son
-- SECURITY DEFINER y no se afectan. INSERT y DELETE siguen igual (Better Auth crea y borra).
-- ===========================================================================================
REVOKE UPDATE ON "organization" FROM vocero_app;
--> statement-breakpoint
GRANT UPDATE ("name", "slug", "logo", "metadata") ON "organization" TO vocero_app;
--> statement-breakpoint
-- P5: por D3 no deben existir llaves de IA de los negocios; cifradas no le sirven a nadie. La
-- tabla vacía se elimina en el bloque V, con su RLS. Irreversible, aprobado por Andres.
DELETE FROM "ai_credentials";
--> statement-breakpoint
-- Cambiar el tope de un negocio (0 apaga su Laboratorio). Anota en registro_panel.
CREATE OR REPLACE FUNCTION vocero_panel_tope_laboratorio(p_org text, p_tope integer)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  quien text := vocero_panel_quien();
  resultado integer;
BEGIN
  IF p_tope IS NULL OR p_tope < 0 OR p_tope > 20 THEN
    RAISE EXCEPTION 'vocero_panel: tope fuera de 0 a 20' USING ERRCODE = '22023';
  END IF;
  UPDATE organization o SET lab_corridas_por_dia = p_tope WHERE o.id = p_org
  RETURNING o.lab_corridas_por_dia INTO resultado;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'vocero_panel: negocio inexistente' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO registro_panel (id, superadmin_id, accion, negocio_id, detalle)
  VALUES ('rp_' || md5(random()::text || clock_timestamp()::text), quien,
          'tope_laboratorio', p_org, jsonb_build_object('tope', p_tope));
  RETURN resultado;
END
$$;
--> statement-breakpoint
-- Los negocios, ahora con el tope del Laboratorio y sus corridas de hoy (en UTC: es un dato de
-- salud, no de pacientes). Cambia el tipo de retorno: hay que borrarla y volver a crearla.
DROP FUNCTION IF EXISTS vocero_panel_negocios();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION vocero_panel_negocios()
RETURNS TABLE (
  id text, nombre text, slug text, creado_en timestamp, pausado_en timestamp,
  agente_encendido boolean, whatsapp boolean, instagram boolean, messenger boolean, tiktok boolean,
  usuarios bigint, conversaciones bigint, conversaciones_7d bigint, entrantes_24h bigint,
  ultimo_entrante_en timestamp, despachos_pendientes bigint, a_humano_24h bigint,
  webhooks_pendientes bigint, webhooks_agotados bigint, retencion_dias integer,
  lab_tope integer, lab_corridas_hoy bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  ahora timestamp := (now() AT TIME ZONE 'UTC');
BEGIN
  PERFORM vocero_panel_quien();
  RETURN QUERY
  SELECT o.id, o.name, o.slug, o.created_at, o.pausado_en,
    coalesce((SELECT a.enabled FROM agent_profile a WHERE a.organization_id = o.id LIMIT 1), false),
    EXISTS (SELECT 1 FROM meta_credentials c WHERE c.organization_id = o.id AND c.status = 'connected'),
    EXISTS (SELECT 1 FROM instagram_credentials c WHERE c.organization_id = o.id AND c.status = 'connected'),
    EXISTS (SELECT 1 FROM messenger_credentials c WHERE c.organization_id = o.id AND c.status = 'connected'),
    EXISTS (SELECT 1 FROM tiktok_credentials c WHERE c.organization_id = o.id AND c.status = 'connected'),
    (SELECT count(DISTINCT m.user_id) FROM member m WHERE m.organization_id = o.id),
    (SELECT count(*) FROM conversation c WHERE c.organization_id = o.id AND NOT c.is_test),
    (SELECT count(*) FROM conversation c
      WHERE c.organization_id = o.id AND NOT c.is_test AND c.last_inbound_at > ahora - interval '7 days'),
    (SELECT count(*) FROM message m JOIN conversation c ON c.id = m.conversation_id
      WHERE m.organization_id = o.id AND m.direction = 'in' AND NOT c.is_test
        AND m.created_at > ahora - interval '24 hours'),
    (SELECT max(c.last_inbound_at) FROM conversation c WHERE c.organization_id = o.id AND NOT c.is_test),
    (SELECT count(*) FROM dispatch d WHERE d.organization_id = o.id AND d.status IN ('pendiente', 'en_vuelo')),
    (SELECT count(*) FROM dispatch d WHERE d.organization_id = o.id AND d.status = 'caducado_a_humano'
      AND d.updated_at > ahora - interval '24 hours'),
    (SELECT count(*) FROM webhook_event w WHERE w.organization_id = o.id AND w.status IN ('pendiente', 'en_proceso')),
    (SELECT count(*) FROM webhook_event w WHERE w.organization_id = o.id AND w.status = 'agotado'),
    (SELECT p.retencion_dias FROM privacy_profile p WHERE p.organization_id = o.id LIMIT 1),
    o.lab_corridas_por_dia,
    (SELECT count(*) FROM agent_test_run r
      WHERE r.organization_id = o.id AND r.started_at >= date_trunc('day', ahora))
  FROM organization o
  ORDER BY o.created_at, o.id;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION vocero_panel_negocios(), vocero_panel_tope_laboratorio(text, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION vocero_panel_negocios(), vocero_panel_tope_laboratorio(text, integer) TO vocero_panel;
