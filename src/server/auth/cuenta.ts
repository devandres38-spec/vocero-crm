import { sql } from "drizzle-orm";
import { getAuth, runInternalSignup } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { comoSistema } from "@/lib/db/contexto";

/**
 * 076 (pendiente del bloque G, respuesta 3 de Andres) — Cambiar la propia
 * contraseña («Mi cuenta»), para cualquier usuario: el personal de un negocio
 * y el superadmin.
 *
 * Usa `changePassword` de Better Auth con `revokeOtherSessions` (se cierran
 * las demás sesiones). Su ruta HTTP `/change-password` está cerrada: el único
 * camino es este, que además limpia `debe_cambiar_contrasena`. Mínimo 12
 * caracteres para toda contraseña nueva.
 */
export const MINIMO_CONTRASENA = 12;

export type ResultadoDelCambio =
  | { ok: true; cookies: string[] }
  | { ok: false; status: 400 | 401 | 422 | 429; codigo: string; mensaje: string };

export function validarNueva(actual: string, nueva: string): ResultadoDelCambio | null {
  if (nueva.length < MINIMO_CONTRASENA) {
    return {
      ok: false,
      status: 422,
      codigo: "corta",
      mensaje: `La contraseña nueva debe tener al menos ${MINIMO_CONTRASENA} caracteres`,
    };
  }
  if (nueva.length > 128) {
    return { ok: false, status: 422, codigo: "larga", mensaje: "La contraseña nueva es demasiado larga" };
  }
  if (nueva === actual) {
    return { ok: false, status: 422, codigo: "igual", mensaje: "La contraseña nueva debe ser distinta de la actual" };
  }
  return null;
}

/** Limpia la marca: ya puso su propia contraseña. `user` no tiene RLS. */
export async function marcarContrasenaPropia(userId: string): Promise<void> {
  await comoSistema("cuenta", () =>
    getDb().execute(sql`update "user" set debe_cambiar_contrasena = false where id = ${userId}::text`)
  );
}

export async function cambiarContrasena(
  cabeceras: Headers,
  actual: string,
  nueva: string,
  deps: {
    cambiar?: (h: Headers, actual: string, nueva: string) => Promise<Response>;
    sesion?: (h: Headers) => Promise<{ userId: string } | null>;
    marcar?: (userId: string) => Promise<void>;
  } = {}
): Promise<ResultadoDelCambio> {
  const invalida = validarNueva(actual, nueva);
  if (invalida) return invalida;

  const sesion = await (deps.sesion ??
    (async (h: Headers) => {
      const s = await getAuth().api.getSession({ headers: h });
      return s ? { userId: s.user.id } : null;
    }))(cabeceras);
  if (!sesion) return { ok: false, status: 401, codigo: "sin_sesion", mensaje: "Inicia sesión otra vez" };

  const respuesta = await (deps.cambiar ??
    ((h: Headers, a: string, n: string) =>
      runInternalSignup(() =>
        getAuth().api.changePassword({
          body: { currentPassword: a, newPassword: n, revokeOtherSessions: true },
          headers: h,
          asResponse: true,
        })
      )))(cabeceras, actual, nueva);

  if (!respuesta.ok) {
    if (respuesta.status === 429) {
      return { ok: false, status: 429, codigo: "intentos", mensaje: "Demasiados intentos. Espera unos minutos." };
    }
    return { ok: false, status: 400, codigo: "actual", mensaje: "La contraseña actual no es correcta" };
  }
  await (deps.marcar ?? marcarContrasenaPropia)(sesion.userId);
  return { ok: true, cookies: respuesta.headers.getSetCookie() };
}
