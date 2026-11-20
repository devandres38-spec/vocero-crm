import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { CONFIRMACION_BAJA, notaDeBaja } from "@/lib/baja";
import { publish } from "@/server/events/bus";
import { sendText } from "@/server/inbox/send";
import { crearNotaDelSistema } from "@/server/notas";

/**
 * 073-B (D6, decisión #6) — Opt-out por la Ley 1581 de 2012.
 *
 * Vive fuera de `server/bot` e `server/inbox`: deja una nota del sistema, y el
 * guardarraíl de notas (`notas-internas.test.ts`) vigila esas carpetas. Solo
 * ESCRIBE notas; nunca las lee.
 *
 * - `contact.optOutAt` bloquea la IA (despacho y respuestas), las plantillas
 *   y los seguimientos del cerebro (que salen por `/messages`).
 * - Una persona puede contestar a mano dentro de la ventana (con aviso).
 * - No se revierte sola: solo `reactivarContacto`, a pedido explícito.
 */

export type OrigenBaja = "detector" | "agente" | "operador";

/**
 * Registra la baja. Idempotente: solo la PRIMERA vez confirma al cliente y
 * deja la nota. Devuelve `true` si esta llamada fue la que la registró.
 * Nunca lanza: lo que falle se registra en el log.
 */
export async function registrarBaja(input: {
  organizationId: string;
  conversationId: string;
  origen: OrigenBaja;
}): Promise<boolean> {
  try {
    const db = getDb();
    const [conv] = await db
      .select({ contactId: schema.conversation.contactId, isTest: schema.conversation.isTest })
      .from(schema.conversation)
      .where(
        and(
          eq(schema.conversation.organizationId, input.organizationId),
          eq(schema.conversation.id, input.conversationId)
        )
      )
      .limit(1);
    if (!conv || conv.isTest) return false;

    const ahora = new Date();
    const marcada = await db
      .update(schema.contact)
      .set({ optOutAt: ahora, optOutSource: input.origen, updatedAt: ahora })
      .where(
        and(
          eq(schema.contact.organizationId, input.organizationId),
          eq(schema.contact.id, conv.contactId),
          isNull(schema.contact.optOutAt)
        )
      )
      .returning({ id: schema.contact.id });
    const nueva = marcada.length > 0;

    if (nueva && input.origen !== "operador") {
      // La confirmación sale ANTES de pausar y una sola vez. Si el canal no
      // la acepta (ventana cerrada, Meta caído), la baja vale igual.
      try {
        await sendText({
          organizationId: input.organizationId,
          conversationId: input.conversationId,
          text: CONFIRMACION_BAJA,
          aiGenerated: true,
        });
      } catch (err) {
        console.warn("[baja] no pude enviar la confirmación:", err instanceof Error ? err.message : err);
      }
    }

    // La IA se pausa siempre; el motivo `opt_out` solo si no había otro.
    await db
      .update(schema.conversation)
      .set({
        aiEnabled: false,
        handoffAt: sql`coalesce(${schema.conversation.handoffAt}, ${ahora.toISOString()}::timestamp)`,
        handoffReason: sql`case when ${schema.conversation.handoffAt} is null then 'opt_out' else ${schema.conversation.handoffReason} end`,
        updatedAt: ahora,
      })
      .where(
        and(
          eq(schema.conversation.organizationId, input.organizationId),
          eq(schema.conversation.id, input.conversationId)
        )
      );

    if (nueva) await crearNotaDelSistema(input.organizationId, input.conversationId, notaDeBaja(input.origen));
    publish(input.organizationId, {
      type: "conversation.updated",
      data: { conversation: { id: input.conversationId } },
    });
    if (nueva) console.info(`[baja] ${input.conversationId} (${input.origen}) en ${input.organizationId}`);
    return nueva;
  } catch (err) {
    console.error("[baja] no pude registrar la baja:", err);
    return false;
  }
}

/** Reactivación explícita (una persona del equipo). No enciende la IA. */
export async function reactivarContacto(organizationId: string, contactId: string): Promise<boolean> {
  const filas = await getDb()
    .update(schema.contact)
    .set({ optOutAt: null, optOutSource: null, updatedAt: new Date() })
    .where(and(eq(schema.contact.organizationId, organizationId), eq(schema.contact.id, contactId)))
    .returning({ id: schema.contact.id });
  return filas.length > 0;
}

/** ¿El contacto de esta conversación pidió la baja? */
export async function conversacionDadaDeBaja(organizationId: string, conversationId: string): Promise<boolean> {
  const [fila] = await getDb()
    .select({ optOutAt: schema.contact.optOutAt })
    .from(schema.conversation)
    .innerJoin(schema.contact, eq(schema.conversation.contactId, schema.contact.id))
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, conversationId)
      )
    )
    .limit(1);
  return Boolean(fila?.optOutAt);
}
