import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import {
  MAX_TEXT_CHARS_ANY_CHANNEL,
  TEXT_TOO_LONG_ANY_CHANNEL,
} from "@/server/channels/capabilities";
import { SendError, sendText } from "@/server/inbox/send";
import { guardarRespuestaDePrueba } from "@/server/lab/sandbox";

/**
 * 070 (D5) — Lo que hace un cerebro al responder, sin autenticación ni forma
 * HTTP: `/api/bot/messages` y `/api/brains/messages` lo traducen cada una a
 * su contrato (200 vs 201; `window_closed` 409 vs `fuera_de_ventana` 422).
 *
 * Usa el mismo camino que el composer (`sendText`): el token de WhatsApp no
 * sale del CRM, el mensaje queda marcado como IA, respeta la ventana y el
 * guard de sandbox. En una conversación de prueba (033) se GUARDA y no se
 * envía.
 */

export const cuerpoRespuestaCerebro = z.object({
  // Auditoría 070 (M-11): con tope.
  conversationId: z.string().min(1).max(128),
  // 022: el tope de aquí es el del canal que más admite; el de cada canal
  // lo comprueba el envío y sale como el mismo 422 `invalid_body` de siempre.
  text: z.string().min(1).max(MAX_TEXT_CHARS_ANY_CHANNEL, TEXT_TOO_LONG_ANY_CHANNEL),
});

export type FalloRespuesta =
  | "not_found"
  | "ai_paused"
  | "window_closed"
  | "sandbox_violation"
  | "message_limit"
  | "text_too_long"
  | "organizacion_suspendida"
  | "send_failed";

export type ResultadoRespuesta =
  | { ok: true; messageId: string; prueba: boolean }
  | { ok: false; code: FalloRespuesta; message: string; detalle?: string };

export async function responderComoCerebro(input: {
  organizationId: string;
  conversationId: string;
  text: string;
}): Promise<ResultadoRespuesta> {
  // Gate de handoff: el bot JAMÁS habla sobre una conversación pausada. Se
  // relee aquí porque entre que el bot pidió el contexto y armó su respuesta
  // (segundos de un LLM) el dueño pudo haber tomado la conversación.
  const convs = await getDb()
    .select({
      aiEnabled: schema.conversation.aiEnabled,
      handoffAt: schema.conversation.handoffAt,
      isTest: schema.conversation.isTest,
    })
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, input.organizationId),
        eq(schema.conversation.id, input.conversationId)
      )
    )
    .limit(1);
  const conv = convs[0];
  if (!conv) return { ok: false, code: "not_found", message: "Conversación no encontrada" };
  if (!conv.aiEnabled || conv.handoffAt) {
    return { ok: false, code: "ai_paused", message: "La IA está en pausa en esta conversación" };
  }
  if (conv.isTest) {
    const guardada = await guardarRespuestaDePrueba({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      text: input.text,
    });
    return { ok: true, messageId: guardada.messageId, prueba: true };
  }

  try {
    const result = await sendText({
      conversationId: input.conversationId,
      organizationId: input.organizationId,
      text: input.text,
      aiGenerated: true,
    });
    return { ok: true, messageId: result.messageId, prueba: false };
  } catch (err) {
    if (err instanceof SendError) {
      switch (err.code) {
        case "window_closed":
        case "sandbox_violation":
        case "message_limit":
        case "text_too_long":
        case "organizacion_suspendida":
          return { ok: false, code: err.code, message: err.message };
        default:
          return { ok: false, code: "send_failed", message: err.message, detalle: err.code };
      }
    }
    throw err;
  }
}
