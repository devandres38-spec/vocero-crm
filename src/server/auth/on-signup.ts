import { APIError } from "better-auth/api";
import { membresiaDe } from "@/server/db-sistema";

/**
 * 074 — Un usuario nuevo ya no crea su negocio (antes, el primer registro de
 * una instalación vacía lo hacía): los negocios los crea `crearNegocio`
 * (`alta.ts`). Aquí solo queda resolver a qué negocio pertenece una sesión.
 *
 * 075 — Antes de saber el negocio no se puede leer `member` (tiene RLS): la
 * membresía sale de `vocero_membresia`, que solo devuelve el negocio y el rol,
 * la primera por fecha (un correo pertenece a un solo negocio).
 */

/** Organización activa de un usuario (su primera membresía). */
export async function resolveActiveOrganizationId(
  userId: string
): Promise<string | null> {
  return (await resolveMembership(userId))?.organizationId ?? null;
}

export async function resolveMembership(
  userId: string
): Promise<{ organizationId: string; role: string; pausado: boolean } | null> {
  return membresiaDe(userId);
}

/** 076 — Lo que ve el personal de un negocio pausado al intentar entrar. */
export const MENSAJE_NEGOCIO_PAUSADO = "Este negocio está pausado. Escríbele a Aliantis para reactivarlo.";

/**
 * 076 — Antes de crear una sesión (gancho de Better Auth): fija el negocio
 * activo y, si el negocio está pausado, no deja entrar (403 con el motivo).
 * Un superadmin no tiene negocio: su sesión nace sin organización activa.
 */
export async function antesDeCrearSesion<S extends { userId: string }>(
  session: S
): Promise<{ data: S & { activeOrganizationId: string | null } }> {
  const membresia = await resolveMembership(session.userId);
  if (membresia?.pausado) {
    throw new APIError("FORBIDDEN", { message: MENSAJE_NEGOCIO_PAUSADO });
  }
  return { data: { ...session, activeOrganizationId: membresia?.organizationId ?? null } };
}
