import { createHash } from "node:crypto";
import { and, count, desc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { conteoDeWebhooks } from "@/server/db-sistema";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { perfilVigente } from "@/server/privacy/repositorio";
import { filtrarPayload } from "@/server/privacy/webhook";

/**
 * 047 — Los eventos de webhook guardados antes de procesarse.
 *
 * El mismo patrón que el outbox del despacho (021): reclamar una fila es un
 * `UPDATE` condicionado al estado y al contador de intentos, y una reserva
 * vencida devuelve la fila al barrido. La garantía la da Postgres, no un
 * temporizador: sobrevive a un reinicio a media ingesta.
 */

export type FuenteWebhook = (typeof schema.webhookEvent.$inferSelect)["fuente"];
export type FilaEvento = typeof schema.webhookEvent.$inferSelect;

/** Cuánto se reserva un evento mientras se procesa. Una ingesta tarda segundos: los adjuntos se bajan aparte. */
export const LEASE_MS = 120_000;
export const MAX_INTENTOS = 6;
/** La espera tras el intento 1, 2… 5. El sexto ya no reintenta: queda agotado. */
export const ESPERAS_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000];
/** Con mocks y `WEBHOOK_RETRY_FAST=1`, para que el arnés E2E no espere horas. */
const ESPERA_RAPIDA_MS = 300;

/** Pura: la espera base antes del siguiente intento. */
export function esperaDeReintento(intentosHechos: number): number {
  const i = Math.min(Math.max(intentosHechos, 1), ESPERAS_MS.length) - 1;
  return ESPERAS_MS[i] ?? ESPERAS_MS[0]!;
}

function esperaConVariacion(intentosHechos: number): number {
  if (process.env.WEBHOOK_RETRY_FAST === "1" && process.env.WA_MOCK_ENABLED === "true") {
    return ESPERA_RAPIDA_MS;
  }
  const base = esperaDeReintento(intentosHechos);
  // Variación: sin ella, los eventos que fallaron juntos (la base parpadeó)
  // reintentan juntos y vuelven a encontrarla igual de ocupada.
  return base + Math.floor(Math.random() * base * 0.3);
}

/** Pura: la huella del cuerpo crudo. La misma entrega dos veces es una fila. */
export function huellaDe(rawBody: string): string {
  return createHash("sha256").update(rawBody, "utf8").digest("hex");
}

/** Pura: lo que se guarda de un error. Nunca el cuerpo: solo el mensaje, recortado. */
export function resumenDeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return (msg || "error desconocido").slice(0, 300);
}

/**
 * Guarda el evento. Si el mismo cuerpo ya estaba, devuelve la fila que había
 * (`nuevo: false`): quien llama no lo vuelve a procesar.
 *
 * 069 — Lo que se guarda es el payload FILTRADO con el perfil de privacidad del
 * negocio (sin perfil legible, el texto del paciente no se guarda): ningún
 * texto crudo llega a `webhook_event`. La huella sigue siendo la del cuerpo
 * crudo, para deduplicar las reentregas de la fuente.
 *
 * Lanza si la base no responde: la ruta contesta 503 y reintenta quien mandó.
 */
export async function guardarEvento(params: {
  organizationId: string;
  fuente: FuenteWebhook;
  payload: unknown;
  rawBody: string;
}): Promise<{ id: string; nuevo: boolean }> {
  const db = getDb();
  const huella = huellaDe(params.rawBody);
  const id = newId("webhookEvent");
  const perfil = await perfilVigente(params.organizationId, db);
  const payload = filtrarPayload(params.payload, perfil?.politica ?? null);
  const [nueva] = await db
    .insert(schema.webhookEvent)
    .values({
      id,
      organizationId: params.organizationId,
      fuente: params.fuente,
      payload: payload as object,
      huella,
    })
    .onConflictDoNothing({ target: schema.webhookEvent.huella })
    .returning({ id: schema.webhookEvent.id });
  if (nueva) return { id: nueva.id, nuevo: true };
  const [existente] = await db
    .select({ id: schema.webhookEvent.id })
    .from(schema.webhookEvent)
    .where(eq(schema.webhookEvent.huella, huella))
    .limit(1);
  return { id: existente?.id ?? id, nuevo: false };
}

/**
 * Reclama un evento concreto: el que la ruta acaba de guardar. `null` si ya no
 * está para tomarse (lo tomó el barrido, o ya se procesó).
 */
export async function tomarEvento(
  id: string,
  ahora: Date = new Date()
): Promise<FilaEvento | null> {
  const [fila] = await getDb()
    .select()
    .from(schema.webhookEvent)
    .where(eq(schema.webhookEvent.id, id))
    .limit(1);
  if (!fila) return null;
  return reclamar(fila, ahora);
}

/**
 * Toma hasta `limite` eventos listos: pendientes cuya hora llegó, o en proceso
 * con la reserva vencida (el proceso que los tenía murió a mitad).
 */
export async function tomarPendientes(
  limite = 10,
  ahora: Date = new Date()
): Promise<FilaEvento[]> {
  const candidatos = await getDb()
    .select()
    .from(schema.webhookEvent)
    .where(
      or(
        and(
          eq(schema.webhookEvent.status, "pendiente"),
          lte(schema.webhookEvent.notBefore, ahora)
        ),
        and(
          eq(schema.webhookEvent.status, "en_proceso"),
          lte(schema.webhookEvent.leasedUntil, ahora)
        )
      )
    )
    .orderBy(schema.webhookEvent.notBefore)
    .limit(limite);
  const tomados: FilaEvento[] = [];
  for (const fila of candidatos) {
    const t = await reclamar(fila, ahora);
    if (t) tomados.push(t);
  }
  return tomados;
}

/**
 * El reclamo es este UPDATE, condicionado al estado y al contador de intentos
 * (igual que en el despacho: comparar timestamps falla en silencio por la
 * diferencia de precisión entre Postgres y `Date`).
 */
async function reclamar(fila: FilaEvento, ahora: Date): Promise<FilaEvento | null> {
  const disponible =
    fila.status === "pendiente"
      ? lte(schema.webhookEvent.notBefore, ahora)
      : fila.status === "en_proceso"
        ? lte(schema.webhookEvent.leasedUntil, ahora)
        : null;
  if (!disponible) return null;
  const [tomada] = await getDb()
    .update(schema.webhookEvent)
    .set({
      status: "en_proceso",
      attempts: fila.attempts + 1,
      leasedUntil: new Date(ahora.getTime() + LEASE_MS),
      updatedAt: ahora,
    })
    .where(
      and(
        eq(schema.webhookEvent.id, fila.id),
        eq(schema.webhookEvent.status, fila.status),
        eq(schema.webhookEvent.attempts, fila.attempts),
        disponible
      )
    )
    .returning();
  return tomada ?? null;
}

/** La fila sigue siendo de quien la reclamó. */
function propietario(fila: FilaEvento) {
  return and(
    eq(schema.webhookEvent.id, fila.id),
    eq(schema.webhookEvent.status, "en_proceso"),
    eq(schema.webhookEvent.attempts, fila.attempts)
  );
}

export async function marcarProcesado(fila: FilaEvento): Promise<void> {
  const ahora = new Date();
  await getDb()
    .update(schema.webhookEvent)
    .set({
      status: "procesado",
      leasedUntil: null,
      lastError: null,
      processedAt: ahora,
      updatedAt: ahora,
    })
    .where(propietario(fila));
}

/**
 * Programa el siguiente intento, o lo deja agotado si ya no quedan.
 * Devuelve cuándo se reintenta, o `null` si quedó agotado.
 */
export async function reintentarOAgotar(
  fila: FilaEvento,
  err: unknown,
  ahora: Date = new Date()
): Promise<Date | null> {
  const lastError = resumenDeError(err);
  if (fila.attempts >= MAX_INTENTOS) {
    await getDb()
      .update(schema.webhookEvent)
      .set({ status: "agotado", leasedUntil: null, lastError, updatedAt: ahora })
      .where(propietario(fila));
    return null;
  }
  const notBefore = new Date(ahora.getTime() + esperaConVariacion(fila.attempts));
  await getDb()
    .update(schema.webhookEvent)
    .set({ status: "pendiente", notBefore, leasedUntil: null, lastError, updatedAt: ahora })
    .where(propietario(fila));
  return notBefore;
}

/**
 * «Reintentar» de Ajustes: los agotados de la organización vuelven a empezar.
 * Devuelve cuántos.
 */
export async function reintentarAgotados(organizationId: string): Promise<number> {
  const ahora = new Date();
  const filas = await getDb()
    .update(schema.webhookEvent)
    .set({ status: "pendiente", attempts: 0, notBefore: ahora, updatedAt: ahora })
    .where(
      scoped(
        schema.webhookEvent.organizationId,
        organizationId,
        eq(schema.webhookEvent.status, "agotado")
      )
    )
    .returning({ id: schema.webhookEvent.id });
  return filas.length;
}

export type EstadoEntregas = {
  pendientes: number;
  agotados: number;
  /** Del agotado más reciente; si no hay, del pendiente más reciente con error. */
  ultimoError: string | null;
  ultimoFalloEn: string | null;
};

/** Lo que enseña Ajustes → WhatsApp. Conteos y el último error; nunca el payload. */
export async function estadoDeEntregas(organizationId: string): Promise<EstadoEntregas> {
  const db = getDb();
  const filas = await db
    .select({ status: schema.webhookEvent.status, n: count() })
    .from(schema.webhookEvent)
    .where(
      scoped(
        schema.webhookEvent.organizationId,
        organizationId,
        inArray(schema.webhookEvent.status, ["pendiente", "en_proceso", "agotado"])
      )
    )
    .groupBy(schema.webhookEvent.status);
  const n = (s: string) => Number(filas.find((f) => f.status === s)?.n ?? 0);
  const agotados = n("agotado");
  const [ultimo] = await db
    .select({ lastError: schema.webhookEvent.lastError, updatedAt: schema.webhookEvent.updatedAt })
    .from(schema.webhookEvent)
    .where(
      scoped(
        schema.webhookEvent.organizationId,
        organizationId,
        agotados > 0
          ? eq(schema.webhookEvent.status, "agotado")
          : and(
              eq(schema.webhookEvent.status, "pendiente"),
              sql`${schema.webhookEvent.lastError} is not null`
            )
      )
    )
    .orderBy(desc(schema.webhookEvent.updatedAt))
    .limit(1);
  return {
    // Uno en proceso cuenta como pendiente: todavía no se sabe si entra.
    pendientes: n("pendiente") + n("en_proceso"),
    agotados,
    ultimoError: ultimo?.lastError ?? null,
    ultimoFalloEn: ultimo ? ultimo.updatedAt.toISOString() : null,
  };
}

/** Para `/api/health`: de toda la instancia, sin datos. */
export async function conteoGlobal(): Promise<{ pendientes: number; agotados: number }> {
  // 075 — Entre todos los negocios: por la función de solo números (RLS).
  return conteoDeWebhooks();
}

export const RETENCION_PROCESADO_MS = 7 * 24 * 3_600_000;
export const RETENCION_AGOTADO_MS = 30 * 24 * 3_600_000;

/** Borra lo que ya no hace falta: el cuerpo trae datos del cliente (D7). */
export async function purgar(ahora: Date = new Date()): Promise<number> {
  const filas = await getDb()
    .delete(schema.webhookEvent)
    .where(
      or(
        and(
          eq(schema.webhookEvent.status, "procesado"),
          lt(schema.webhookEvent.updatedAt, new Date(ahora.getTime() - RETENCION_PROCESADO_MS))
        ),
        and(
          eq(schema.webhookEvent.status, "agotado"),
          lt(schema.webhookEvent.updatedAt, new Date(ahora.getTime() - RETENCION_AGOTADO_MS))
        )
      )
    )
    .returning({ id: schema.webhookEvent.id });
  return filas.length;
}
