import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import perfilDemo from "./perfil-privacidad-demo.json";
import { sembrarPerfil, type ResultadoSembrar } from "./sembrar";

/**
 * 068 — El perfil de privacidad de la demo (FR-008): el de `clientes/demo`
 * del cerebro (odontología, CO), exportado con `npm run privacidad:exportar`.
 * Es el que usa el cerebro para esa organización, así que las huellas cuadran.
 *
 * Solo lo llama `pnpm seed:demo` (el comando de Andres), nunca la ruta
 * `/api/seed/demo` que puede usar el negocio (D5). Y no pisa un perfil que ya
 * exista: `--force` recarga los datos de la demo, no la privacidad.
 */
type Db = ReturnType<typeof getDb>;

export async function sembrarPerfilDemo(
  db: Db,
  organizationId: string
): Promise<ResultadoSembrar | { ok: true; yaTenia: true }> {
  const [existente] = await db
    .select({ id: schema.privacyProfile.id })
    .from(schema.privacyProfile)
    .where(scoped(schema.privacyProfile.organizationId, organizationId))
    .limit(1);
  if (existente) return { ok: true, yaTenia: true };
  return sembrarPerfil(db, {
    organizationId,
    contenido: JSON.stringify(perfilDemo),
    sinFiltroSalud: false,
  });
}
