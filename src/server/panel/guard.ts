import { sql } from "drizzle-orm";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { comoSistema } from "@/lib/db/contexto";

/**
 * 076 (D16 de Aliantis) — Quién puede entrar al panel de Andres. En orden:
 * 1. una sesión de Better Auth válida;
 * 2. su usuario está en `superadministrador` (si no, el panel «no existe»);
 * 3. tiene el segundo factor activado (si no, solo la pantalla para activarlo);
 * 4. la sesión nació DESPUÉS de activarlo (una de antes no sirve);
 * 5. la sesión tiene menos de 12 h (respuesta 6 de Andres).
 *
 * `decidirPanel` es la regla, pura y con su prueba; `estadoDelPanel` lee la
 * sesión y `superadministrador` (sin RLS: la app solo puede leerla) en
 * `comoSistema`, ANTES de entrar al panel.
 */

export const SESION_MAXIMA_DEL_PANEL_MS = 12 * 60 * 60 * 1000;

export type Superadmin = { userId: string; nombre: string; correo: string };

export type EstadoDelPanel =
  | { tipo: "sin_sesion" }
  | { tipo: "no_es" }
  | { tipo: "sin_segundo_factor"; superadmin: Superadmin }
  | { tipo: "sesion_vieja" }
  | { tipo: "ok"; superadmin: Superadmin };

export type DatosDelGuard = {
  sesion: {
    creadaEn: Date;
    usuario: { id: string; name: string; email: string; twoFactorEnabled?: boolean | null };
  } | null;
  /** La fila de `superadministrador`: `null` si no es superadmin. */
  superadmin: { totpActivadoEn: Date | null } | null;
  ahora: Date;
};

export function decidirPanel({ sesion, superadmin, ahora }: DatosDelGuard): EstadoDelPanel {
  if (!sesion) return { tipo: "sin_sesion" };
  if (!superadmin) return { tipo: "no_es" };
  const quien: Superadmin = {
    userId: sesion.usuario.id,
    nombre: sesion.usuario.name,
    correo: sesion.usuario.email,
  };
  if (sesion.usuario.twoFactorEnabled !== true || !superadmin.totpActivadoEn) {
    return { tipo: "sin_segundo_factor", superadmin: quien };
  }
  if (sesion.creadaEn.getTime() < superadmin.totpActivadoEn.getTime()) return { tipo: "sesion_vieja" };
  if (ahora.getTime() - sesion.creadaEn.getTime() > SESION_MAXIMA_DEL_PANEL_MS) {
    return { tipo: "sesion_vieja" };
  }
  return { tipo: "ok", superadmin: quien };
}

/** La fila de `superadministrador` de un usuario (o `null`). */
async function filaDeSuperadmin(userId: string): Promise<{ totpActivadoEn: Date | null } | null> {
  return comoSistema("panel", async () => {
    const r = (await getDb().execute(sql`
      select totp_activado_en at time zone 'UTC' as totp
      from superadministrador where user_id = ${userId}::text`)) as unknown as {
      totp: Date | string | null;
    }[];
    const f = r[0];
    if (!f) return null;
    return { totpActivadoEn: f.totp ? new Date(f.totp) : null };
  });
}

export async function estadoDelPanel(cabeceras?: Headers): Promise<EstadoDelPanel> {
  const h = cabeceras ?? (await headers());
  const s = await getAuth().api.getSession({ headers: h });
  if (!s) return { tipo: "sin_sesion" };
  return decidirPanel({
    sesion: {
      creadaEn: new Date(s.session.createdAt),
      usuario: {
        id: s.user.id,
        name: s.user.name,
        email: s.user.email,
        twoFactorEnabled: (s.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled,
      },
    },
    superadmin: await filaDeSuperadmin(s.user.id),
    ahora: new Date(),
  });
}

/** Para la raíz y el login: ¿la sesión es de un superadmin (con o sin segundo factor)? */
export async function esSesionDeSuperadmin(): Promise<boolean> {
  const e = await estadoDelPanel();
  return e.tipo === "ok" || e.tipo === "sin_segundo_factor" || e.tipo === "sesion_vieja";
}

/**
 * El superadmin acaba de activar su TOTP: se marca la fecha (las sesiones de
 * antes dejan de servir) y se cierran TODAS sus sesiones; vuelve a entrar con
 * contraseña y código. La función de la base solo marca si de verdad es
 * superadmin con el segundo factor activado.
 */
export async function cerrarTrasActivarSegundoFactor(userId: string): Promise<boolean> {
  return comoSistema("panel", async () => {
    const r = (await getDb().execute(
      sql`select vocero_superadmin_marcar_totp(${userId}::text) as marcado`
    )) as unknown as { marcado: unknown }[];
    await getDb().execute(sql`delete from session where user_id = ${userId}::text`);
    return r[0]?.marcado !== null && r[0]?.marcado !== undefined;
  });
}
