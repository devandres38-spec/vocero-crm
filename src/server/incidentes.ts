import { sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { crearNotaDelSistema } from "@/server/notas";

/**
 * 073-A (D3) — Incidentes del bot: lo que falló y nadie vio.
 *
 * Una fila por (organización, `dedupeKey`). Repetir el mismo incidente suma
 * `count` y mueve `lastAt`: una llave sin saldo con cientos de mensajes
 * entrantes es UNA fila por hora, no cientos. Se purga a los 90 días
 * (`purgarIncidentesViejos`, en el barrido de webhooks). El panel que los
 * muestra llega en la 074.
 */

export type TipoIncidente = (typeof schema.botIncident.$inferInsert)["kind"];

/** La hora (UTC) como parte de la clave: agrupa los repetidos de una hora. */
export function cuboHora(ahora: Date = new Date()): string {
  return ahora.toISOString().slice(0, 13);
}

/**
 * Registra (o suma) un incidente. Devuelve `true` si es la primera vez de
 * esa clave —para no repetir avisos— y `false` si sumó o si falló. Nunca
 * lanza: registrar un fallo no puede ser otro fallo.
 */
export async function registrarIncidente(input: {
  organizationId: string;
  conversationId?: string | null;
  kind: TipoIncidente;
  detail?: string | null;
  dedupeKey: string;
  ahora?: Date;
}): Promise<boolean> {
  const ahora = input.ahora ?? new Date();
  const t = schema.botIncident;
  try {
    const [fila] = await getDb()
      .insert(t)
      .values({
        id: newId("botIncident"),
        organizationId: input.organizationId,
        conversationId: input.conversationId ?? null,
        kind: input.kind,
        detail: input.detail?.slice(0, 500) ?? null,
        dedupeKey: input.dedupeKey.slice(0, 200),
        firstAt: ahora,
        lastAt: ahora,
      })
      .onConflictDoUpdate({
        target: [t.organizationId, t.dedupeKey],
        set: {
          count: sql`${t.count} + 1`,
          lastAt: ahora,
          detail: sql`excluded.detail`,
        },
      })
      .returning({ count: t.count });
    return fila?.count === 1;
  } catch (err) {
    console.error(`[incidentes] no se pudo registrar ${input.kind}:`, err);
    return false;
  }
}

/**
 * 073-A (decisión #3) — El cerebro no recibió (o rechazó) el turno de esta
 * conversación. Antes la conversación pasaba a una persona con
 * `aiEnabled=false` PARA SIEMPRE: un redeploy de Nea apagaba la IA de todos
 * los chats activos. Ahora queda el incidente y una nota interna en la
 * conversación —la primera vez de cada hora—, y la IA sigue encendida: el
 * siguiente mensaje del cliente vuelve a despacharse.
 */
export async function avisarCaidaDelCerebro(input: {
  organizationId: string;
  conversationId: string;
  detalle: string;
  ahora?: Date;
}): Promise<void> {
  const ahora = input.ahora ?? new Date();
  const nuevo = await registrarIncidente({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    kind: "despacho_caducado",
    detail: input.detalle,
    dedupeKey: `despacho_caducado:${input.conversationId}:${cuboHora(ahora)}`,
    ahora,
  });
  if (!nuevo) return;
  await crearNotaDelSistema(
    input.organizationId,
    input.conversationId,
    "⚠️ El agente de IA no pudo contestar este mensaje (el cerebro no respondió a tiempo). " +
      "Revisa si alguien del equipo debe responder. La IA sigue activa para los próximos mensajes."
  );
}

/** Retención: 90 días, en lotes acotados (como `purgarLlamadasViejas`). */
export const RETENCION_INCIDENTES_MS = 90 * 24 * 60 * 60 * 1000;
const LOTE_PURGA = 1000;
const MAX_LOTES = 10;

export async function purgarIncidentesViejos(ahora: Date = new Date()): Promise<number> {
  const corte = new Date(ahora.getTime() - RETENCION_INCIDENTES_MS);
  const t = schema.botIncident;
  let total = 0;
  for (let i = 0; i < MAX_LOTES; i++) {
    const r = await getDb().execute(
      sql`delete from ${t} where ${t.id} in (select ${t.id} from ${t} where ${t.lastAt} < ${corte} limit ${LOTE_PURGA})`
    );
    const n = Number((r as unknown as { count?: number }).count ?? 0);
    total += n;
    if (n < LOTE_PURGA) break;
  }
  return total;
}
