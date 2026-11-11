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
): Promise<{ organizationId: string; role: string } | null> {
  return membresiaDe(userId);
}
