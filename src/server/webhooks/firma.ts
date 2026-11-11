import { isValidSignature } from "@/server/inbox/webhook";
import { appSecretDe, type CanalMeta } from "@/server/whatsapp/app-secret";
import { firmaObligatoria } from "./obligatoria";
import { organizacionesDeLaEntrega } from "./organizacion";

/**
 * 073 (D14 de Aliantis) — La firma de los webhooks de Meta, POR NEGOCIO Y
 * CANAL. El segmento secreto de la URL es uno para toda la instalación y el
 * cliente lo ve en su app de Meta: lo que aísla de verdad es la firma con el
 * App Secret de SU app. La `META_APP_SECRET` global ya no protege webhooks.
 *
 * Orden: el cuerpo crudo ya llegó; se lee a qué negocio va; se verifica con
 * el secreto de ese negocio para ese canal; recién después se guarda.
 *
 * - Una entrega que no es de ningún negocio conectado: pasa con `null` y se
 *   descarta como siempre (nada que proteger, nada se guarda).
 * - Una entrega que mezcla negocios: rechazada.
 * - Sin secreto registrado: rechazada en producción; fuera de producción
 *   pasa (desarrollo y mocks sin secreto).
 */

export const FUENTE_DE_CANAL = {
  whatsapp: "whatsapp",
  instagram: "meta_instagram",
  messenger: "meta_messenger",
} as const;


export type ResultadoFirma =
  | { ok: true; organizationId: string | null }
  | { ok: false; motivo: "varios_negocios" | "sin_secreto" | "firma_invalida" };

export type DepsFirma = {
  organizaciones: typeof organizacionesDeLaEntrega;
  secretoDe: (organizationId: string, canal: CanalMeta) => Promise<string | null>;
  obligatoria: () => boolean;
};

const depsReales: DepsFirma = {
  organizaciones: organizacionesDeLaEntrega,
  secretoDe: (org, canal) => appSecretDe(org, canal),
  obligatoria: firmaObligatoria,
};

export async function verificarFirmaMeta(
  canal: CanalMeta,
  payload: unknown,
  rawBody: string,
  cabecera: string | null,
  deps: DepsFirma = depsReales
): Promise<ResultadoFirma> {
  const orgs = await deps.organizaciones(FUENTE_DE_CANAL[canal], payload);
  if (orgs.length === 0) return { ok: true, organizationId: null };
  if (orgs.length > 1) {
    console.warn(`[webhooks] entrega de ${canal} con ${orgs.length} negocios: rechazada`);
    return { ok: false, motivo: "varios_negocios" };
  }
  const organizationId = orgs[0]!;
  const secreto = await deps.secretoDe(organizationId, canal);
  if (!secreto) {
    if (deps.obligatoria()) {
      console.warn(
        `[webhooks] ${organizationId} no tiene App Secret de ${canal} (pnpm meta:secreto): entrega rechazada`
      );
      return { ok: false, motivo: "sin_secreto" };
    }
    return { ok: true, organizationId };
  }
  if (!isValidSignature(rawBody, cabecera, secreto)) {
    return { ok: false, motivo: "firma_invalida" };
  }
  return { ok: true, organizationId };
}
