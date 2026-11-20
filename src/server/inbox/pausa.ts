import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { publish } from "@/server/events/bus";

/**
 * 073-B (D1, decisión #1) — Una persona respondió: la IA se pausa con
 * `manual_reply`. Vale para el eco del teléfono (008, `ingest.ts`) y para
 * cualquier respuesta de un operador desde la Bandeja web (`send.ts`).
 *
 * Atómica e idempotente: solo escribe si la conversación no estaba ya en
 * handoff (un motivo anterior —`hostilidad`, `opt_out`…— no se pisa). No
 * reactiva nunca: reanudar es decisión explícita de una persona (#2).
 *
 * Devuelve `true` si esta llamada fue la que pausó.
 */
export async function pausarPorRespuestaHumana(
  organizationId: string,
  conversationId: string,
  /**
   * Auditoría 073-B — Desde cuándo atiende la persona: el `createdAt` del
   * mensaje que la pausó. Con la hora de la pausa (posterior al mensaje) el
   * primer mensaje humano quedaba FUERA del `humanGap`.
   */
  desde: Date
): Promise<boolean> {
  const ahora = new Date();
  const paused = await getDb()
    .update(schema.conversation)
    .set({
      aiEnabled: false,
      handoffAt: desde,
      handoffReason: "manual_reply",
      updatedAt: ahora,
    })
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, conversationId),
        sql`${schema.conversation.handoffAt} is null`
      )
    )
    .returning({ id: schema.conversation.id });
  if (!paused[0]) return false;
  publish(organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: conversationId } },
  });
  return true;
}
