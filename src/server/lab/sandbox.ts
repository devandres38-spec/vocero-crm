import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";

/**
 * Sandbox del Laboratorio: la respuesta del agente a una conversación de
 * prueba se GUARDA en el hilo y no se envía a ningún lado.
 *
 * La usan el agente incluido (`pipeline.ts`) y, desde la 033, cualquier
 * cerebro que conteste por `POST /api/bot/messages`. El envío real sigue
 * siendo imposible para `is_test`: `sendText` lanza `sandbox_violation`, y no
 * se toca.
 */
export async function guardarRespuestaDePrueba(params: {
  organizationId: string;
  conversationId: string;
  text: string;
  /** 070: los botones se guardan con la respuesta, como en una real. */
  buttons?: { id: string; title: string }[];
  /** 071: la llave de idempotencia del cerebro; un repetido no guarda otra. */
  clientMessageId?: string;
}): Promise<{ messageId: string; repetido?: true }> {
  const db = getDb();
  const messageId = newId("message");
  const guardado = await db.insert(schema.message).values({
    id: messageId,
    organizationId: params.organizationId,
    conversationId: params.conversationId,
    direction: "out",
    type: "text",
    text: params.text,
    status: "sent",
    aiGenerated: true,
    origin: "ai",
    buttons: params.buttons?.length ? params.buttons : null,
    clientMessageId: params.clientMessageId ?? null,
  })
    .onConflictDoNothing()
    .returning({ id: schema.message.id });
  if (!guardado[0] && params.clientMessageId) {
    const [previo] = await db
      .select({ id: schema.message.id })
      .from(schema.message)
      .where(
        and(
          eq(schema.message.organizationId, params.organizationId),
          eq(schema.message.clientMessageId, params.clientMessageId)
        )
      )
      .limit(1);
    if (previo) return { messageId: previo.id, repetido: true };
  }
  await db
    .update(schema.conversation)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(schema.conversation.id, params.conversationId),
        eq(schema.conversation.organizationId, params.organizationId)
      )
    );
  return { messageId };
}
