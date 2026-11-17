import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * 069 (D7) — ¿Está suspendida? Lo consultan los caminos que no pasan por la
 * sesión (envío, despacho). La ingesta de webhooks NO lo consulta: una
 * organización suspendida sigue recibiendo y guardando, para no perder nada.
 */
export async function organizacionSuspendida(organizationId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ status: schema.organization.status })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return rows[0]?.status === "suspendida";
}
