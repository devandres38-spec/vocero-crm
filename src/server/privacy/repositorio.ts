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

/**
 * 069 — La política de un negocio y la huella de su perfil, o `null` (D3).
 * La huella viaja en el despacho para que el cerebro note un perfil viejo.
 */
export async function perfilVigente(
  organizationId: string,
  db: Db = getDb()
): Promise<{ politica: PrivacyPolicy; huella: string; adjuntos: boolean } | null> {
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
  return {
    politica: politicaDesdePerfil(perfil.data),
    huella: perfil.data.huella,
    // 070 (D1): fuera de la huella; sin perfil legible, apagado.
    adjuntos: fila.adjuntos,
  };
}

export async function perfilDePrivacidad(
  organizationId: string,
  db: Db = getDb()
): Promise<PrivacyPolicy | null> {
  return (await perfilVigente(organizationId, db))?.politica ?? null;
}

/**
 * 070 (D1) — Si se guardan los archivos de los pacientes: apagado si el
 * perfil filtra salud, encendido si no, salvo que Andres lo fuerce.
 */
/**
 * 072 (D1) — Días de retención: el mismo rango y valor por defecto que
 * `retencion_dias` del cerebro (`client-config.ts`).
 */
export const RETENCION_MINIMA = 7;
export const RETENCION_MAXIMA = 3650;
export const RETENCION_POR_DEFECTO = 90;

export function retencionValida(dias: number): boolean {
  return Number.isInteger(dias) && dias >= RETENCION_MINIMA && dias <= RETENCION_MAXIMA;
}

export function adjuntosPorDefecto(perfil: PerfilPrivacidad): boolean {
  return perfil.sensible === null;
}

/**
 * Inserta o reemplaza el perfil de un negocio. Devuelve la huella del que
 * había, para que Andres vea qué cambió. El perfil ya viene validado.
 */
export async function guardarPerfil(
  db: Db,
  organizationId: string,
  perfil: PerfilPrivacidad,
  opciones: { adjuntos?: boolean; retencionDias?: number } = {}
): Promise<{ huellaAnterior: string | null }> {
  const [anterior] = await db
    .select({ fingerprint: schema.privacyProfile.fingerprint })
    .from(schema.privacyProfile)
    .where(scoped(schema.privacyProfile.organizationId, organizationId))
    .limit(1);
  const columnas = {
    ...filaDesdePerfil(organizationId, perfil),
    adjuntos: opciones.adjuntos ?? adjuntosPorDefecto(perfil),
    // 072: sin `--retencion`, un perfil nuevo toma 90 (el default de la
    // columna) y uno que se vuelve a sembrar conserva sus días.
    ...(opciones.retencionDias === undefined
      ? {}
      : { retencionDias: opciones.retencionDias }),
  };
  await db
    .insert(schema.privacyProfile)
    .values({ id: newId("privacyProfile"), ...columnas })
    .onConflictDoUpdate({
      target: schema.privacyProfile.organizationId,
      set: { ...columnas, updatedAt: new Date() },
    });
  return { huellaAnterior: anterior?.fingerprint ?? null };
}
