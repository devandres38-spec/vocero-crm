import {
  and,
  eq,
  inArray,
  isNotNull,
  lt,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/lib/db";
import { vaciarFichasInactivas } from "@/server/bot/ficha";
import { RETENCION_POR_DEFECTO } from "@/server/privacy/repositorio";
import { deleteMediaFile } from "@/server/whatsapp/media";

/**
 * 072 (D21 de Aliantis) — Retención por negocio con borrado diario.
 *
 * Lo que pasa de N días (`privacy_profile.retencion_dias`, 90 sin perfil) pierde
 * su CONTENIDO: el texto de los mensajes, sus botones y adjuntos, las notas,
 * la ficha de un contacto inactivo, las transcripciones del Laboratorio y las
 * copias en `webhook_event`. Se conservan las filas y los metadatos que cuenta
 * Resultados (dirección, origen, estado, fechas), el consentimiento, el lead,
 * sus etapas y la tarjeta del anuncio.
 *
 * Idempotente: cada consulta busca solo lo que todavía tiene contenido. Una
 * pasada repetida no cambia nada.
 */

/** Lo que queda de un mensaje vaciado por antigüedad. */
export const RETENTION_TEXT = "[mensaje borrado por antigüedad]";

export const RETENCION_CADA_MS = 24 * 3_600_000;
const DIA_MS = 24 * 3_600_000;
/** Mensajes por transacción: una tanda corta no frena la bandeja. */
export const TANDA_MENSAJES = 500;
/** Tope de tandas por negocio y pasada: lo que falte, mañana. */
const MAX_TANDAS = 200;

export type ResumenNegocio = {
  organizationId: string;
  dias: number;
  /** Otra instancia tenía el negocio tomado: se salta hasta la próxima pasada. */
  saltado: boolean;
  mensajes: number;
  adjuntos: number;
  notas: number;
  citas: number;
  etapas: number;
  contactos: number;
  laboratorio: number;
  webhooks: number;
  archivosFallidos: number;
};

// Las subconsultas de `not exists` no necesitan conexión: SQL armado aparte.
const qb = new QueryBuilder();

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/** El instante antes del cual se vacía: `ahora − N días`. Lo que cae justo en él se queda. */
export function corteDe(ahora: Date, dias: number): Date {
  return new Date(ahora.getTime() - dias * DIA_MS);
}

/** Cada negocio con sus días; sin perfil de privacidad, 90. */
export async function negociosConRetencion(): Promise<
  { organizationId: string; dias: number }[]
> {
  // Mantenimiento de toda la instancia (como `purgar` de webhooks): recorre
  // cada negocio y después trabaja SOLO dentro de él.
  const filas = await getDb()
    .select({
      organizationId: schema.organization.id,
      dias: schema.privacyProfile.retencionDias,
    })
    .from(schema.organization)
    .leftJoin(
      schema.privacyProfile,
      eq(schema.privacyProfile.organizationId, schema.organization.id),
    );
  return filas.map((f) => ({
    organizationId: f.organizationId,
    dias: f.dias ?? RETENCION_POR_DEFECTO,
  }));
}

/** El candado de un negocio, solo por esta transacción. `false`: otra instancia lo tiene. */
async function tomarNegocio(tx: Tx, organizationId: string): Promise<boolean> {
  const filas = (await tx.execute(
    sql`select pg_try_advisory_xact_lock(hashtext(${`retencion:${organizationId}`})) as ok`,
  )) as unknown as { ok: boolean }[];
  return filas[0]?.ok === true;
}

/**
 * Una tanda de mensajes: vacía hasta `TANDA_MENSAJES` con contenido y borra los
 * adjuntos que dejaron de usarse. Devuelve los ids de los archivos a borrar
 * DESPUÉS del commit, o `null` si el negocio estaba tomado.
 */
async function tandaDeMensajes(
  organizationId: string,
  corte: Date,
): Promise<{ mensajes: number; adjuntos: string[] } | null> {
  return getDb().transaction(async (tx) => {
    if (!(await tomarNegocio(tx, organizationId))) return null;
    const conContenido = or(
      and(
        isNotNull(schema.message.text),
        ne(schema.message.text, RETENTION_TEXT),
      ),
      isNotNull(schema.message.buttons),
      isNotNull(schema.message.mediaAssetId),
    );
    const viejos = await tx
      .select({
        id: schema.message.id,
        mediaAssetId: schema.message.mediaAssetId,
      })
      .from(schema.message)
      .where(
        and(
          eq(schema.message.organizationId, organizationId),
          lt(schema.message.createdAt, corte),
          conContenido,
        ),
      )
      .limit(TANDA_MENSAJES);
    if (viejos.length === 0) return { mensajes: 0, adjuntos: [] };

    await tx
      .update(schema.message)
      .set({ text: RETENTION_TEXT, buttons: null, mediaAssetId: null })
      .where(
        and(
          eq(schema.message.organizationId, organizationId),
          inArray(
            schema.message.id,
            viejos.map((m) => m.id),
          ),
        ),
      );

    const candidatos = [
      ...new Set(
        viejos
          .map((m) => m.mediaAssetId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const adjuntos =
      candidatos.length === 0
        ? []
        : await borrarAdjuntosSinUso(
            tx,
            organizationId,
            inArray(schema.mediaAsset.id, candidatos),
          );
    return { mensajes: viejos.length, adjuntos };
  });
}

/**
 * Borra las filas de `media_asset` del negocio que cumplen `filtro` y que ya
 * nadie usa: ni un mensaje (un reenvío reciente comparte el adjunto) ni la
 * tarjeta de un anuncio. Devuelve sus ids, para borrar los archivos.
 */
async function borrarAdjuntosSinUso(
  tx: Tx,
  organizationId: string,
  filtro: ReturnType<typeof and>,
): Promise<string[]> {
  const borrados = await tx
    .delete(schema.mediaAsset)
    .where(
      and(
        eq(schema.mediaAsset.organizationId, organizationId),
        filtro,
        notExists(
          qb
            .select({ uno: sql`1` })
            .from(schema.message)
            .where(eq(schema.message.mediaAssetId, schema.mediaAsset.id)),
        ),
        notExists(
          qb
            .select({ uno: sql`1` })
            .from(schema.adAttribution)
            .where(eq(schema.adAttribution.imageAssetId, schema.mediaAsset.id)),
        ),
      ),
    )
    .returning({ id: schema.mediaAsset.id });
  return borrados.map((a) => a.id);
}

type LoDemas = Pick<
  ResumenNegocio,
  | "adjuntos"
  | "notas"
  | "citas"
  | "etapas"
  | "contactos"
  | "laboratorio"
  | "webhooks"
> & { archivos: string[] };

/** Lo demás del negocio, en una transacción: son pocas filas y consultas por conjunto. */
async function vaciarLoDemas(
  organizationId: string,
  corte: Date,
): Promise<LoDemas | null> {
  return getDb().transaction(async (tx) => {
    if (!(await tomarNegocio(tx, organizationId))) return null;

    // Adjuntos huérfanos viejos (su mensaje se borró por otra vía).
    const archivos = await borrarAdjuntosSinUso(
      tx,
      organizationId,
      lt(schema.mediaAsset.createdAt, corte),
    );

    const notas = await tx
      .delete(schema.conversationNote)
      .where(
        and(
          eq(schema.conversationNote.organizationId, organizationId),
          lt(schema.conversationNote.createdAt, corte),
        ),
      )
      .returning({ id: schema.conversationNote.id });

    // Una cita futura agendada hace tiempo conserva su nota hasta que pase.
    const citas = await tx
      .update(schema.booking)
      .set({ notes: null })
      .where(
        and(
          eq(schema.booking.organizationId, organizationId),
          isNotNull(schema.booking.notes),
          lt(schema.booking.createdAt, corte),
          lt(schema.booking.scheduledAt, corte),
        ),
      )
      .returning({ id: schema.booking.id });

    const etapas = await tx
      .update(schema.leadStageEvent)
      .set({ lossNote: null })
      .where(
        and(
          eq(schema.leadStageEvent.organizationId, organizationId),
          isNotNull(schema.leadStageEvent.lossNote),
          lt(schema.leadStageEvent.occurredAt, corte),
        ),
      )
      .returning({ id: schema.leadStageEvent.id });

    // Un contacto inactivo: sin cambios desde el corte y sin conversación con
    // mensajes desde el corte. El nombre, el teléfono y la identidad se quedan.
    // Un contacto inactivo pierde notas y ficha; la ficha solo la escribe su
    // puerta (`bot/ficha.ts`, guardarraíl `ficha-guard.test.ts`).
    const contactos = await vaciarFichasInactivas(tx, organizationId, corte);

    const laboratorio = await tx
      .update(schema.agentTestCase)
      .set({ transcript: null, hallazgos: null })
      .where(
        and(
          eq(schema.agentTestCase.organizationId, organizationId),
          or(
            isNotNull(schema.agentTestCase.transcript),
            isNotNull(schema.agentTestCase.hallazgos),
          ),
          lt(schema.agentTestCase.createdAt, corte),
        ),
      )
      .returning({ id: schema.agentTestCase.id });

    const webhooks = await tx
      .delete(schema.webhookEvent)
      .where(
        and(
          eq(schema.webhookEvent.organizationId, organizationId),
          lt(schema.webhookEvent.createdAt, corte),
        ),
      )
      .returning({ id: schema.webhookEvent.id });

    return {
      adjuntos: archivos.length,
      archivos,
      notas: notas.length,
      citas: citas.length,
      etapas: etapas.length,
      contactos: contactos.length,
      laboratorio: laboratorio.length,
      webhooks: webhooks.length,
    };
  });
}

async function borrarArchivos(
  organizationId: string,
  ids: string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const intentos = await Promise.allSettled(
    ids.map((id) => deleteMediaFile(organizationId, id)),
  );
  return intentos.filter((r) => r.status === "rejected").length;
}

/** Vacía un negocio: los mensajes por tandas y después lo demás. */
export async function vaciarNegocio(
  organizationId: string,
  dias: number,
  ahora: Date,
): Promise<ResumenNegocio> {
  const corte = corteDe(ahora, dias);
  const resumen: ResumenNegocio = {
    organizationId,
    dias,
    saltado: false,
    mensajes: 0,
    adjuntos: 0,
    notas: 0,
    citas: 0,
    etapas: 0,
    contactos: 0,
    laboratorio: 0,
    webhooks: 0,
    archivosFallidos: 0,
  };

  for (let i = 0; i < MAX_TANDAS; i++) {
    const tanda = await tandaDeMensajes(organizationId, corte);
    if (!tanda) return { ...resumen, saltado: true };
    resumen.mensajes += tanda.mensajes;
    resumen.adjuntos += tanda.adjuntos.length;
    // Los archivos, DESPUÉS del commit (mismo criterio que `olvidar.ts`).
    resumen.archivosFallidos += await borrarArchivos(
      organizationId,
      tanda.adjuntos,
    );
    if (tanda.mensajes < TANDA_MENSAJES) break;
  }

  const demas = await vaciarLoDemas(organizationId, corte);
  if (!demas) return { ...resumen, saltado: true };
  const { archivos, ...conteos } = demas;
  resumen.archivosFallidos += await borrarArchivos(organizationId, archivos);
  return {
    ...resumen,
    ...conteos,
    adjuntos: resumen.adjuntos + conteos.adjuntos,
  };
}

// En globalThis: en dev los módulos se evalúan más de una vez.
const g = globalThis as unknown as { __voceroRetencionCorriendo?: boolean };

/**
 * Una pasada por todos los negocios. Un negocio que falla no frena a los
 * demás. El registro dice cuántas filas, nunca qué contenían. Devuelve `null`
 * si ya había una pasada corriendo en este proceso.
 */
export async function aplicarRetencion(
  ahora: Date = new Date(),
): Promise<ResumenNegocio[] | null> {
  if (g.__voceroRetencionCorriendo) return null;
  g.__voceroRetencionCorriendo = true;
  try {
    const resumenes: ResumenNegocio[] = [];
    for (const { organizationId, dias } of await negociosConRetencion()) {
      try {
        const r = await vaciarNegocio(organizationId, dias, ahora);
        resumenes.push(r);
        const total =
          r.mensajes +
          r.adjuntos +
          r.notas +
          r.citas +
          r.etapas +
          r.contactos +
          r.laboratorio +
          r.webhooks;
        if (r.saltado) {
          console.warn(
            `[retencion] ${organizationId}: otra instancia lo está vaciando; queda para la próxima pasada`,
          );
        } else if (total > 0 || r.archivosFallidos > 0) {
          console.log(
            `[retencion] ${organizationId} (${dias} días): ${r.mensajes} mensajes, ${r.adjuntos} adjuntos, ` +
              `${r.notas} notas, ${r.citas} citas, ${r.etapas} etapas, ${r.contactos} contactos, ` +
              `${r.laboratorio} casos del Laboratorio, ${r.webhooks} webhooks` +
              (r.archivosFallidos > 0
                ? `; ${r.archivosFallidos} archivos no se pudieron borrar del volumen`
                : ""),
          );
        }
      } catch (err) {
        console.error(
          `[retencion] ${organizationId}: la pasada falló y se reintenta mañana:`,
          err instanceof Error ? err.message : "error desconocido",
        );
      }
    }
    return resumenes;
  } finally {
    g.__voceroRetencionCorriendo = false;
  }
}
