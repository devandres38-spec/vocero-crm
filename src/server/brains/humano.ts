import { and, desc, eq, gt, gte, lte, ne, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { disponibilidadHumana } from "@/lib/horario-humano";
import type { AjustesDelNegocio } from "@/server/ajustes-bot";

/**
 * 073-B (D1) — Lo que pasó mientras atendía una persona (`humanGap` del
 * contexto, contrato brains-073 §3).
 *
 * El tramo va de la pausa (`handoffAt` o el interruptor) a la reanudación
 * (`conversation.humanGapFrom/To`, que escribe `updateConversation`). El
 * cerebro lo lee UNA vez: en cuanto la IA vuelve a contestar algo después de
 * la reanudación, deja de viajar. Si el primer turno falla sin contestar,
 * el siguiente lo vuelve a recibir.
 *
 * Solo mensajes del hilo (cliente y equipo); nunca notas internas.
 */

export const HUMAN_GAP_MAX_MENSAJES = 20;
export const HUMAN_GAP_MAX_CARACTERES = 2000;

export type MensajeDelTramo = {
  at: string;
  author: "lead" | "humano";
  /** `text`, `image`, `audio`… Sin texto (un adjunto), `text` es null. */
  type: string;
  text: string | null;
};

export type HumanGap = { since: string; until: string; messages: MensajeDelTramo[] };

type Fila = { direction: "in" | "out"; type: string; text: string | null; createdAt: Date };

/**
 * Pura: de lo más nuevo a lo más viejo hasta llenar los topes, devuelto en
 * orden cronológico. Un texto que no cabe entero se recorta por delante (lo
 * último que se dijo es lo que importa).
 */
export function armarTramo(filasDesc: Fila[], maxCaracteres = HUMAN_GAP_MAX_CARACTERES): MensajeDelTramo[] {
  const out: MensajeDelTramo[] = [];
  let quedan = maxCaracteres;
  for (const f of filasDesc.slice(0, HUMAN_GAP_MAX_MENSAJES)) {
    if (quedan <= 0) break;
    let text = f.text?.trim() ? f.text.trim() : null;
    if (text && text.length > quedan) text = "…" + text.slice(text.length - quedan + 1);
    quedan -= text?.length ?? 0;
    out.push({
      at: f.createdAt.toISOString(),
      author: f.direction === "in" ? "lead" : "humano",
      type: f.type,
      text,
    });
  }
  return out.reverse();
}

export async function tramoHumano(
  organizationId: string,
  conversationId: string,
  desde: Date | null,
  hasta: Date | null
): Promise<HumanGap | null> {
  if (!desde || !hasta || hasta < desde) return null;
  const db = getDb();
  const m = schema.message;
  // ¿La IA ya contestó después de reanudar? Entonces ya lo leyó.
  const [yaLeido] = await db
    .select({ id: m.id })
    .from(m)
    .where(
      and(
        eq(m.organizationId, organizationId),
        eq(m.conversationId, conversationId),
        eq(m.origin, "ai"),
        eq(m.direction, "out"),
        ne(m.status, "failed"),
        gt(m.createdAt, hasta)
      )
    )
    .limit(1);
  if (yaLeido) return null;

  const filas = await db
    .select({ direction: m.direction, type: m.type, text: m.text, createdAt: m.createdAt })
    .from(m)
    .where(
      and(
        eq(m.organizationId, organizationId),
        eq(m.conversationId, conversationId),
        gte(m.createdAt, desde),
        lte(m.createdAt, hasta),
        // Del cliente, o de una persona del equipo (Bandeja, teléfono, plantilla).
        // (lo que no salió no lo leyó nadie).
        or(eq(m.direction, "in"), and(ne(m.origin, "ai"), ne(m.status, "failed")))
      )
    )
    .orderBy(desc(m.createdAt))
    .limit(HUMAN_GAP_MAX_MENSAJES);
  const messages = armarTramo(filas);
  if (messages.length === 0) return null;
  return { since: desde.toISOString(), until: hasta.toISOString(), messages };
}

/** 073-B (D6) — `humanAvailable`/`nextOpenAt`; vacío sin horario configurado. */
export function camposDeHorario(
  ajustes: Pick<AjustesDelNegocio, "horario" | "timezone">,
  ahora: Date = new Date()
): { humanAvailable?: boolean; nextOpenAt?: string | null } {
  if (!ajustes.horario) return {};
  return disponibilidadHumana(ajustes.horario, ahora, ajustes.timezone);
}
