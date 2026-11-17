import { eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import type { ModulosOrganizacion } from "@/server/modulos/efectivos";
import { igualProfundo, type OrgParaBlueprint, type Tx } from "./metadata";

/**
 * 069 (D11) — Los módulos de la organización. Merge por clave: lo que el
 * Blueprint no menciona se conserva (y sigue heredando el techo si nunca se
 * guardó). Solo la agencia llega aquí; el `owner` no cambia sus módulos.
 */
export async function aplicarModulos(
  tx: Tx,
  org: OrgParaBlueprint,
  deseado: ModulosOrganizacion
): Promise<boolean> {
  const actual = (org.modules && typeof org.modules === "object" ? org.modules : {}) as ModulosOrganizacion;
  const nuevo: ModulosOrganizacion = { ...actual };
  for (const [k, v] of Object.entries(deseado)) {
    if (v !== undefined) (nuevo as Record<string, unknown>)[k] = v;
  }
  if (igualProfundo(actual, nuevo)) return false;
  await tx
    .update(schema.organization)
    .set({ modules: nuevo })
    .where(eq(schema.organization.id, org.id));
  return true;
}
