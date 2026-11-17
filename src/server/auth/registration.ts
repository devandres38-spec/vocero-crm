import { count } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { correosSuperAdmin, esPlataforma, normalizarCorreo } from "@/lib/tenancy";

/**
 * Registro público.
 *
 * - `single`: cerrado tras la primera organización (FR-060), salvo la
 *   variable de escape ALLOW_SIGNUP=true. Las cuentas de equipo las crea el
 *   propietario (bypass interno del gate).
 * - `multi` (069): cerrado SIEMPRE —ALLOW_SIGNUP no cuenta— salvo los correos
 *   de PLATFORM_ADMIN_EMAILS. Los negocios entran por invitación (bypass
 *   interno al aceptarla).
 */
export async function isPublicSignupAllowed(email?: string): Promise<boolean> {
  if (esPlataforma()) {
    return !!email && correosSuperAdmin().has(normalizarCorreo(email));
  }
  if (process.env.ALLOW_SIGNUP === "true") return true;
  const db = getDb();
  const rows = await db.select({ n: count() }).from(schema.organization);
  return (rows[0]?.n ?? 0) === 0;
}
