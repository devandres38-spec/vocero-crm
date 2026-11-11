import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * 073 — Las dos consultas de organización que necesita `requireBot`. Aparte
 * para poder simularlas en las pruebas de cada ruta sin simular la base.
 */

export async function organizacionExiste(organizationId: string): Promise<boolean> {
  const filas = await getDb()
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return filas.length === 1;
}

/** Hasta dos organizaciones: basta para saber si hay una sola. Sin caché: una segunda la apaga al instante. */
export async function hastaDosOrganizaciones(): Promise<string[]> {
  const filas = await getDb()
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .limit(2);
  return filas.map((f) => f.id);
}
