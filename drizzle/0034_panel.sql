-- 076 (bloque I, D16 de Aliantis) — El panel de Andres. La primera parte la generó drizzle-kit
-- (columnas y tablas de schema.ts); la segunda, desde el bloque de abajo, va escrita a mano.
CREATE TABLE "registro_panel" (
	"id" text PRIMARY KEY NOT NULL,
	"cuando" timestamp DEFAULT now() NOT NULL,
	"superadmin_id" text NOT NULL,
	"accion" text NOT NULL,
	"negocio_id" text,
	"detalle" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "superadministrador" (
	"user_id" text PRIMARY KEY NOT NULL,
	"creado_en" timestamp DEFAULT now() NOT NULL,
	"totp_activado_en" timestamp
);
--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "pausado_en" timestamp;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "two_factor_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "debe_cambiar_contrasena" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "superadministrador" ADD CONSTRAINT "superadministrador_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "registro_panel_cuando_idx" ON "registro_panel" USING btree ("cuando");--> statement-breakpoint
CREATE INDEX "two_factor_user_id_idx" ON "two_factor" USING btree ("user_id");
--> statement-breakpoint
-- ===========================================================================================
-- 076 (bloque I, D16 de Aliantis) — El panel de Andres. Lo de abajo está escrito a mano.
--
-- two_factor, superadministrador y registro_panel no tienen organization_id ni RLS (como user).
-- Los ALTER DEFAULT PRIVILEGES de la 0033 le dan a vocero_app CRUD sobre toda tabla nueva:
-- two_factor lo necesita (Better Auth), las otras dos NO, y se le quita aquí.
-- ===========================================================================================
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "superadministrador" FROM vocero_app;
--> statement-breakpoint
REVOKE ALL ON "registro_panel" FROM vocero_app;
--> statement-breakpoint
-- El rol del panel: SIN ningún permiso sobre tablas. Solo ejecuta las funciones vocero_panel_*.
-- La app entra a él con SET LOCAL ROLE (src/lib/db/cliente-rls.ts, comoPanel) pero NO hereda
-- sus permisos (INHERIT FALSE, Postgres 16+): el código de un negocio no puede llamarlas.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vocero_panel') THEN
    CREATE ROLE vocero_panel NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
GRANT vocero_panel TO vocero_app WITH INHERIT FALSE, SET TRUE;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "public" TO vocero_panel;
--> statement-breakpoint
-- La membresía de la sesión ahora dice también si el negocio está pausado.
DROP FUNCTION IF EXISTS vocero_membresia(text);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION vocero_membresia(p_user_id text)
RETURNS TABLE (organization_id text, role text, pausado boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT m.organization_id, m.role, o.pausado_en IS NOT NULL FROM member m
  JOIN organization o ON o.id = m.organization_id
  WHERE m.user_id = p_user_id
  ORDER BY m.created_at, m.id
  LIMIT 1
$$;
--> statement-breakpoint
-- El superadmin activó su TOTP: desde ahora, las sesiones de antes no sirven para el panel.
-- Solo marca la fecha, y solo si de verdad es superadmin con el segundo factor activado.
CREATE OR REPLACE FUNCTION vocero_superadmin_marcar_totp(p_user_id text)
RETURNS timestamp
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  UPDATE superadministrador s SET totp_activado_en = (now() AT TIME ZONE 'UTC')
  FROM "user" u
  WHERE s.user_id = p_user_id AND u.id = s.user_id AND u.two_factor_enabled IS TRUE
  RETURNING s.totp_activado_en
$$;
--> statement-breakpoint
-- Un superadmin nunca es miembro de un negocio (D16: fuera de todo negocio).
CREATE OR REPLACE FUNCTION vocero_member_sin_superadmin()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM superadministrador s WHERE s.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'un superadministrador no puede ser miembro de un negocio' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS member_sin_superadmin ON "member";
--> statement-breakpoint
SELECT 1;
--> statement-breakpoint
-- Quién llama desde el panel: comoPanel fija app.superadmin_id junto con SET LOCAL ROLE. Sin un
-- superadmin válido, ninguna función del panel corre.
CREATE OR REPLACE FUNCTION vocero_panel_quien()
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v text := NULLIF(current_setting('app.superadmin_id', true), '');
BEGIN
  IF v IS NULL OR NOT EXISTS (SELECT 1 FROM superadministrador s WHERE s.user_id = v) THEN
    RAISE EXCEPTION 'vocero_panel: sin superadministrador' USING ERRCODE = '42501';
  END IF;
  RETURN v;
END
$$;
--> statement-breakpoint
-- Los negocios, con conteos y banderas. Sin una sola columna de texto de pacientes o mensajes.
CREATE OR REPLACE FUNCTION vocero_panel_negocios()
RETURNS TABLE (
  id text, nombre text, slug text, creado_en timestamp, pausado_en timestamp,
  agente_encendido boolean, whatsapp boolean, instagram boolean, messenger boolean, tiktok boolean,
  usuarios bigint, conversaciones bigint, conversaciones_7d bigint, entrantes_24h bigint,
  ultimo_entrante_en timestamp, despachos_pendientes bigint, a_humano_24h bigint,
  webhooks_pendientes bigint, webhooks_agotados bigint, retencion_dias integer
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
    (SELECT count(*) FROM member m WHERE m.organization_id = o.id),
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
    (SELECT p.retencion_dias FROM privacy_profile p WHERE p.organization_id = o.id LIMIT 1)
  FROM organization o
  ORDER BY o.created_at, o.id;
END
$$;
--> statement-breakpoint
-- La salud de toda la instalación: solo totales.
CREATE OR REPLACE FUNCTION vocero_panel_salud()
RETURNS TABLE (
  negocios bigint, pausados bigint, webhooks_pendientes bigint, webhooks_agotados bigint,
  despachos_pendientes bigint, despachos_en_vuelo bigint, despachos_vencidos bigint,
  olvidos_pendientes bigint, avisos_pendientes bigint, ultimo_entrante_en timestamp
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  ahora timestamp := (now() AT TIME ZONE 'UTC');
BEGIN
  PERFORM vocero_panel_quien();
  RETURN QUERY
  SELECT
    (SELECT count(*) FROM organization),
    (SELECT count(*) FROM organization o WHERE o.pausado_en IS NOT NULL),
    (SELECT count(*) FROM webhook_event w WHERE w.status IN ('pendiente', 'en_proceso')),
    (SELECT count(*) FROM webhook_event w WHERE w.status = 'agotado'),
    (SELECT count(*) FROM dispatch d WHERE d.status = 'pendiente'),
    (SELECT count(*) FROM dispatch d WHERE d.status = 'en_vuelo'),
    (SELECT count(*) FROM dispatch d
      WHERE (d.status = 'pendiente' AND d.not_before < ahora - interval '5 minutes')
         OR (d.status = 'en_vuelo' AND d.leased_until < ahora)),
    (SELECT count(*) FROM olvido_pendiente p WHERE p.status = 'pendiente'),
    (SELECT count(*) FROM aviso_traspaso a WHERE a.status = 'pendiente'),
    (SELECT max(c.last_inbound_at) FROM conversation c WHERE NOT c.is_test);
END
$$;
--> statement-breakpoint
-- El personal de un negocio (no pacientes): para restablecer contraseñas o quitar cuentas.
CREATE OR REPLACE FUNCTION vocero_panel_usuarios(p_org text)
RETURNS TABLE (
  user_id text, nombre text, correo text, rol text, creado_en timestamp,
  ultima_sesion_en timestamp, debe_cambiar_contrasena boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  PERFORM vocero_panel_quien();
  RETURN QUERY
  SELECT u.id, u.name, u.email, m.role, m.created_at,
    (SELECT max(s.created_at) FROM session s WHERE s.user_id = u.id),
    u.debe_cambiar_contrasena
  FROM member m JOIN "user" u ON u.id = m.user_id
  WHERE m.organization_id = p_org
  ORDER BY m.created_at, m.id;
END
$$;
--> statement-breakpoint
-- Pausar o activar. Al pausar, se cierran las sesiones de su personal.
CREATE OR REPLACE FUNCTION vocero_panel_pausar(p_org text, p_pausar boolean)
RETURNS timestamp
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  quien text := vocero_panel_quien();
  resultado timestamp;
BEGIN
  UPDATE organization o
     SET pausado_en = CASE WHEN p_pausar THEN coalesce(o.pausado_en, (now() AT TIME ZONE 'UTC')) ELSE NULL END
   WHERE o.id = p_org
  RETURNING o.pausado_en INTO resultado;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'vocero_panel: negocio inexistente' USING ERRCODE = 'P0002';
  END IF;
  IF p_pausar THEN
    DELETE FROM session s WHERE s.user_id IN (SELECT m.user_id FROM member m WHERE m.organization_id = p_org);
  END IF;
  INSERT INTO registro_panel (id, superadmin_id, accion, negocio_id, detalle)
  VALUES ('rp_' || md5(random()::text || clock_timestamp()::text), quien,
          CASE WHEN p_pausar THEN 'pausar' ELSE 'activar' END, p_org, '{}'::jsonb);
  RETURN resultado;
END
$$;
--> statement-breakpoint
-- Restablecer la contraseña de alguien del personal. El hash lo calcula la app (el mismo
-- hashPassword de Better Auth); la contraseña en claro nunca llega a la base.
CREATE OR REPLACE FUNCTION vocero_panel_restablecer(p_org text, p_user_id text, p_hash text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  quien text := vocero_panel_quien();
  v_correo text;
BEGIN
  SELECT u.email INTO v_correo FROM member m JOIN "user" u ON u.id = m.user_id
   WHERE m.organization_id = p_org AND m.user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'vocero_panel: ese usuario no es de ese negocio' USING ERRCODE = 'P0002';
  END IF;
  UPDATE account a SET password = p_hash, updated_at = (now() AT TIME ZONE 'UTC')
   WHERE a.user_id = p_user_id AND a.provider_id = 'credential';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'vocero_panel: el usuario no tiene contraseña' USING ERRCODE = 'P0002';
  END IF;
  UPDATE "user" u SET debe_cambiar_contrasena = true, updated_at = (now() AT TIME ZONE 'UTC')
   WHERE u.id = p_user_id;
  DELETE FROM session s WHERE s.user_id = p_user_id;
  INSERT INTO registro_panel (id, superadmin_id, accion, negocio_id, detalle)
  VALUES ('rp_' || md5(random()::text || clock_timestamp()::text), quien, 'restablecer_contrasena', p_org,
          jsonb_build_object('correo', v_correo));
END
$$;
--> statement-breakpoint
-- Quitar una cuenta del personal (un correo es de un solo negocio: se borra la cuenta entera).
-- Nunca al último dueño.
CREATE OR REPLACE FUNCTION vocero_panel_quitar_usuario(p_org text, p_user_id text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  quien text := vocero_panel_quien();
  v_rol text;
  v_correo text;
BEGIN
  SELECT m.role, u.email INTO v_rol, v_correo FROM member m JOIN "user" u ON u.id = m.user_id
   WHERE m.organization_id = p_org AND m.user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'vocero_panel: ese usuario no es de ese negocio' USING ERRCODE = 'P0002';
  END IF;
  IF v_rol = 'owner' AND (SELECT count(*) FROM member m WHERE m.organization_id = p_org AND m.role = 'owner') <= 1 THEN
    RAISE EXCEPTION 'vocero_panel: no se puede quitar al último dueño' USING ERRCODE = '23514';
  END IF;
  DELETE FROM "user" u WHERE u.id = p_user_id;
  INSERT INTO registro_panel (id, superadmin_id, accion, negocio_id, detalle)
  VALUES ('rp_' || md5(random()::text || clock_timestamp()::text), quien, 'quitar_usuario', p_org,
          jsonb_build_object('correo', v_correo, 'rol', v_rol));
END
$$;
--> statement-breakpoint
-- Anotar lo que no pasa por una función del panel (el alta, con crearNegocio).
CREATE OR REPLACE FUNCTION vocero_panel_anotar(p_accion text, p_org text, p_detalle jsonb)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  quien text := vocero_panel_quien();
BEGIN
  IF p_accion NOT IN ('alta_negocio') THEN
    RAISE EXCEPTION 'vocero_panel: acción desconocida' USING ERRCODE = '22023';
  END IF;
  INSERT INTO registro_panel (id, superadmin_id, accion, negocio_id, detalle)
  VALUES ('rp_' || md5(random()::text || clock_timestamp()::text), quien, p_accion, p_org,
          coalesce(p_detalle, '{}'::jsonb));
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION vocero_panel_registro(p_limite integer)
RETURNS TABLE (cuando timestamp, accion text, negocio_id text, nombre text, detalle jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  PERFORM vocero_panel_quien();
  RETURN QUERY
  SELECT r.cuando, r.accion, r.negocio_id, o.name, r.detalle
  FROM registro_panel r LEFT JOIN organization o ON o.id = r.negocio_id
  ORDER BY r.cuando DESC, r.id DESC
  LIMIT greatest(1, least(coalesce(p_limite, 200), 500));
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION
  vocero_membresia(text), vocero_superadmin_marcar_totp(text), vocero_member_sin_superadmin(),
  vocero_panel_quien(), vocero_panel_negocios(), vocero_panel_salud(), vocero_panel_usuarios(text),
  vocero_panel_pausar(text, boolean), vocero_panel_restablecer(text, text, text),
  vocero_panel_quitar_usuario(text, text), vocero_panel_anotar(text, text, jsonb),
  vocero_panel_registro(integer)
  FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION vocero_membresia(text), vocero_superadmin_marcar_totp(text) TO vocero_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  vocero_panel_negocios(), vocero_panel_salud(), vocero_panel_usuarios(text),
  vocero_panel_pausar(text, boolean), vocero_panel_restablecer(text, text, text),
  vocero_panel_quitar_usuario(text, text), vocero_panel_anotar(text, text, jsonb),
  vocero_panel_registro(integer)
  TO vocero_panel;
