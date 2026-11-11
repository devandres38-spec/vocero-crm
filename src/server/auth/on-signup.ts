import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * 074 — Un usuario nuevo ya no crea su negocio (antes, el primer registro de
 * una instalación vacía lo hacía): los negocios los crea `crearNegocio`
 * (`alta.ts`). Aquí solo queda resolver a qué negocio pertenece una sesión.
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
  const db = getDb();
  const rows = await db
    .select({
      organizationId: schema.member.organizationId,
      role: schema.member.role,
    })
    .from(schema.member)
    .where(eq(schema.member.userId, userId))
    // 074 — Un correo pertenece a un solo negocio; aun así, con orden fijo,
    // para que una fila de más nunca cambie de negocio la sesión al azar.
    .orderBy(asc(schema.member.createdAt), asc(schema.member.id))
    .limit(1);
  return rows[0] ?? null;
}
