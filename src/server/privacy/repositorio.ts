import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  PERFIL_FORMATO,
  perfilPrivacidadSchema,
  politicaDesdePerfil,
  type PerfilPrivacidad,
} from "./perfil";
import type { PrivacyPolicy } from "./privacy-filter";

/**
 * 068 — El perfil de privacidad de cada negocio en la base (`privacy_profile`).
 *
 * D3: leer devuelve la política o `null`. Sin fila, con una fila que no pasa
 * el esquema o con una huella que no cuadra, la respuesta es «no hay», nunca
 * un perfil vacío ni un filtro apagado. Quien filtra trata `null` como «sin
 * configuración legible» (`withoutReview`).
 */

type Db = ReturnType<typeof getDb>;
type Fila = typeof schema.privacyProfile.$inferSelect;

/** Las columnas de un perfil ya validado. */
export function filaDesdePerfil(organizationId: string, perfil: PerfilPrivacidad) {
  return {
    organizationId,
    profileName: perfil.perfil,
    profileVersion: perfil.versionPerfil,
    country: perfil.pais,
    sensitiveTerms: perfil.sensible
      ? {
          urgencia: [...perfil.sensible.urgencia],
          sintoma: [...perfil.sensible.sintoma],
          condicion: [...perfil.sensible.condicion],
          medicamento: [...perfil.sensible.medicamento],
        }
      : null,
    allowlist: [...perfil.permitidos],
    fingerprint: perfil.huella,
  };
}

/** Una fila de vuelta al formato del contrato, validada y con su huella recalculada. */
function perfilDeFila(fila: Fila) {
  return perfilPrivacidadSchema.safeParse({
    formato: PERFIL_FORMATO,
    perfil: fila.profileName,
    versionPerfil: fila.profileVersion,
    pais: fila.country,
    sensible: fila.sensitiveTerms,
    permitidos: fila.allowlist,
    huella: fila.fingerprint,
  });
}

export async function perfilDePrivacidad(
  organizationId: string,
  db: Db = getDb()
): Promise<PrivacyPolicy | null> {
  const [fila] = await db
    .select()
    .from(schema.privacyProfile)
    .where(scoped(schema.privacyProfile.organizationId, organizationId))
    .limit(1);
  if (!fila) return null;

  const perfil = perfilDeFila(fila);
  if (!perfil.success) {
    // Solo dónde falló: nunca el contenido del perfil.
    console.error("[privacidad] perfil ilegible: no se revisará el texto", {
      organizationId,
      campos: [...new Set(perfil.error.issues.map((i) => String(i.path[0] ?? "")))],
    });
    return null;
  }
  return politicaDesdePerfil(perfil.data);
}

/**
 * Inserta o reemplaza el perfil de un negocio. Devuelve la huella del que
 * había, para que Andres vea qué cambió. El perfil ya viene validado.
 */
export async function guardarPerfil(
  db: Db,
  organizationId: string,
  perfil: PerfilPrivacidad
): Promise<{ huellaAnterior: string | null }> {
  const [anterior] = await db
    .select({ fingerprint: schema.privacyProfile.fingerprint })
    .from(schema.privacyProfile)
    .where(scoped(schema.privacyProfile.organizationId, organizationId))
    .limit(1);
  const columnas = filaDesdePerfil(organizationId, perfil);
  await db
    .insert(schema.privacyProfile)
    .values({ id: newId("privacyProfile"), ...columnas })
    .onConflictDoUpdate({
      target: schema.privacyProfile.organizationId,
      set: { ...columnas, updatedAt: new Date() },
    });
  return { huellaAnterior: anterior?.fingerprint ?? null };
}
