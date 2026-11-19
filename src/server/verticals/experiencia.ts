import { cache } from "react";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { esPlataforma } from "@/lib/tenancy";
import { esPackId } from "@/verticals/registro";
import {
  EXPERIENCIA_DEFAULT,
  resolverExperiencia,
  type ExperienciaResuelta,
} from "@/verticals/resolver";

/**
 * 072 (FR-003) — La experiencia de UN negocio: su pack ⊕ sus ajustes. Una
 * lectura por petición (`cache()`), resuelta en el servidor y bajada por
 * props: ningún componente de cliente importa `src/verticals/`.
 *
 * D22 — En `single` el pack es `default` y no se consulta la base: una
 * instalación de una empresa ve exactamente lo de 2.11.0.
 */
export const experienciaDe = cache(async (organizationId: string | null | undefined): Promise<ExperienciaResuelta> => {
  if (!organizationId || !esPlataforma()) return EXPERIENCIA_DEFAULT;
  const rows = await getDb()
    .select({
      verticalPack: schema.organization.verticalPack,
      verticalOverrides: schema.organization.verticalOverrides,
    })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  const fila = rows[0];
  if (!fila) return EXPERIENCIA_DEFAULT;
  if (!esPackId(fila.verticalPack)) {
    console.warn(`[verticals] pack desconocido «${fila.verticalPack}» en ${organizationId}: se usa default`);
  }
  return resolverExperiencia(fila.verticalPack, fila.verticalOverrides);
});
