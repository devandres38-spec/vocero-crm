import type { WebhookPayload } from "@/server/inbox/webhook";
import { normalizeMetaPagePayload } from "@/server/messenger/ingest";
import { zernioTargetChannel } from "@/server/zernio/dispatch";
import { negocioDeCuentaZernio } from "@/server/zernio/conexiones";
import { negocioPorCanal, type TipoDeCanal } from "@/server/db-sistema";
import type { ZernioEvent } from "@/server/zernio";
import type { FuenteWebhook } from "./eventos";

/**
 * 047 — A qué organización va un evento, resuelto ANTES de guardarlo
 * (`webhook_event.organization_id` es NOT NULL, Principio III).
 *
 * Usa exactamente los buscadores que ya usa la ingesta de cada canal, así que
 * resuelve lo mismo que ella. `null` = nadie conectó ese número o esa cuenta:
 * la ingesta lo iba a descartar igual, y no se guarda.
 *
 * Los buscadores se inyectan para poder probarlo sin base.
 */
export type Buscadores = {
  porPhoneNumberId: (id: string) => Promise<{ organizationId: string } | null>;
  porWabaId: (id: string) => Promise<{ organizationId: string } | null>;
  porIgUserId: (id: string) => Promise<{ organizationId: string } | null>;
  porPageId: (id: string) => Promise<{ organizationId: string } | null>;
  porCuentaZernio: (evt: ZernioEvent) => Promise<{ organizationId: string } | null>;
};

/**
 * 075 — Antes de saber el negocio no se pueden leer las credenciales (tienen
 * RLS): el negocio sale de `vocero_negocio_por_canal`, que solo devuelve su id.
 */
function porClave(tipo: TipoDeCanal) {
  return async (clave: string) => {
    const organizationId = await negocioPorCanal(tipo, clave);
    return organizationId ? { organizationId } : null;
  };
}

const buscadoresReales: Buscadores = {
  porPhoneNumberId: porClave("phone_number_id"),
  porWabaId: porClave("waba_id"),
  porIgUserId: porClave("ig_user_id"),
  porPageId: porClave("page_id"),
  porCuentaZernio: async (evt) => {
    const canal = zernioTargetChannel(evt);
    if (!canal) return null;
    const organizationId = await negocioDeCuentaZernio(canal, evt.account);
    return organizationId ? { organizationId } : null;
  },
};

/** La primera organización que se resuelva: una entrega trae una sola cuenta. */
async function primera(
  ids: (string | null | undefined)[],
  buscar: (id: string) => Promise<{ organizationId: string } | null>
): Promise<string | null> {
  for (const id of new Set(ids.filter((x): x is string => Boolean(x)))) {
    const found = await buscar(id);
    if (found) return found.organizationId;
  }
  return null;
}

export async function resolverOrganizacion(
  fuente: FuenteWebhook,
  payload: unknown,
  b: Buscadores = buscadoresReales
): Promise<string | null> {
  switch (fuente) {
    case "whatsapp": {
      const entries = (payload as WebhookPayload).entry ?? [];
      const porNumero = await primera(
        entries.flatMap((e) => (e.changes ?? []).map((c) => c.value?.metadata?.phone_number_id)),
        b.porPhoneNumberId
      );
      // Los estados de plantillas llegan a nivel WABA, sin número.
      return porNumero ?? primera(entries.map((e) => e.id), b.porWabaId);
    }
    case "meta_instagram": {
      const entries = (payload as { entry?: { id?: string }[] }).entry ?? [];
      return primera(entries.map((e) => e.id), b.porIgUserId);
    }
    case "meta_messenger":
      return primera(
        normalizeMetaPagePayload(payload).map((e) => e.routeKey),
        b.porPageId
      );
    case "zernio": {
      const found = await b.porCuentaZernio(payload as ZernioEvent);
      return found?.organizationId ?? null;
    }
  }
}

/**
 * 073 — TODAS las organizaciones de una entrega de Meta, para la firma por
 * negocio: una app es de un solo cliente, así que una entrega que mezcla
 * negocios no se acepta. Por entrada: el número (o la WABA, si no trae
 * número), la cuenta de Instagram o la página.
 */
export async function organizacionesDeLaEntrega(
  fuente: "whatsapp" | "meta_instagram" | "meta_messenger",
  payload: unknown,
  b: Buscadores = buscadoresReales
): Promise<string[]> {
  const orgs = new Set<string>();
  const anotar = async (
    ids: (string | null | undefined)[],
    buscar: (id: string) => Promise<{ organizationId: string } | null>
  ): Promise<boolean> => {
    let alguno = false;
    for (const id of new Set(ids.filter((x): x is string => Boolean(x)))) {
      const found = await buscar(id);
      if (found) {
        orgs.add(found.organizationId);
        alguno = true;
      }
    }
    return alguno;
  };
  switch (fuente) {
    case "whatsapp": {
      for (const e of (payload as WebhookPayload).entry ?? []) {
        const porNumero = await anotar(
          (e.changes ?? []).map((c) => c.value?.metadata?.phone_number_id),
          b.porPhoneNumberId
        );
        if (!porNumero) await anotar([e.id], b.porWabaId);
      }
      break;
    }
    case "meta_instagram":
      await anotar(
        ((payload as { entry?: { id?: string }[] }).entry ?? []).map((e) => e.id),
        b.porIgUserId
      );
      break;
    case "meta_messenger":
      await anotar(
        normalizeMetaPagePayload(payload).map((e) => e.routeKey),
        b.porPageId
      );
      break;
  }
  return [...orgs];
}
