import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { apiError, parseBody } from "@/lib/api";
import { requireBot } from "@/server/bot/auth";
import { rutaDelCerebro } from "@/server/bot/ruta";
import { SendError, sendText } from "@/server/inbox/send";
import { guardarRespuestaDePrueba } from "@/server/lab/sandbox";
import { bodySchema } from "@/server/bot/mensaje-del-bot";
import { marcarReservaFallida, reservarEnvio } from "@/server/bot/envio-idempotente";
import { agenteEncendido, saludSinRespuesta } from "@/server/bot/seguridad";

export const dynamic = "force-dynamic";

/**
 * Envío del cerebro externo A TRAVÉS del CRM: el token de WhatsApp nunca sale
 * de aquí. Usa el mismo camino que el composer de la bandeja (`sendText`), así
 * que el mensaje queda en el hilo marcado como IA, respeta la ventana de 24 h
 * y hereda el guard de sandbox del Laboratorio.
 *
 * 033 — En una conversación de prueba del Laboratorio (`is_test`) la
 * respuesta se GUARDA en el hilo y no se envía: es como un cerebro externo
 * contesta una corrida. Antes respondía 409 `sandbox_violation`.
 *
 * 409 tipados: ai_paused (un humano tomó la conversación) · window_closed ·
 * sandbox_violation · message_limit (022: el canal no admite más mensajes
 * hasta que el cliente escriba; hoy, el tope de TikTok).
 */
async function postSinNegocio(req: Request) {
  const auth = await requireBot(req);
  if (auth instanceof Response) return auth;

  const { organizationId } = auth;

  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  // Gate de handoff: el bot JAMÁS habla sobre una conversación pausada. Se
  // relee aquí porque entre que el bot pidió el contexto y armó su respuesta
  // (segundos de un LLM) el dueño pudo haber tomado la conversación.
  const db = getDb();
  const convs = await db
    .select({
      aiEnabled: schema.conversation.aiEnabled,
      handoffAt: schema.conversation.handoffAt,
      isTest: schema.conversation.isTest,
      channel: schema.conversation.channel,
    })
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, body.data.conversationId)
      )
    )
    .limit(1);
  const conv = convs[0];
  if (!conv) return apiError(404, "not_found", "Conversación no encontrada");
  if (!conv.aiEnabled || conv.handoffAt) {
    return apiError(409, "ai_paused", "La IA está en pausa en esta conversación");
  }
  // 070 — Los botones son de WhatsApp: en otro canal no se envía nada (el
  // cerebro manda el texto sin ellos). También en el Laboratorio.
  if (body.data.buttons && conv.channel !== "whatsapp") {
    return apiError(409, "canal_sin_botones", "Este canal no admite botones");
  }
  // 071 (3.8) — Con el Agente apagado, en una conversación real, solo pasa un
  // mensaje de seguridad por cada entrante de salud. El Laboratorio no.
  if (!conv.isTest && !(await agenteEncendido(organizationId))) {
    const seguridad =
      body.data.motivo === "seguridad" &&
      (await saludSinRespuesta(organizationId, body.data.conversationId));
    if (!seguridad) {
      return apiError(409, "agente_apagado", "El agente está apagado en este negocio");
    }
  }
  if (conv.isTest) {
    const guardada = await guardarRespuestaDePrueba({
      organizationId,
      conversationId: body.data.conversationId,
      text: body.data.text,
      ...(body.data.buttons ? { buttons: body.data.buttons } : {}),
      ...(body.data.clientMessageId ? { clientMessageId: body.data.clientMessageId } : {}),
    });
    return Response.json({
      messageId: guardada.messageId,
      status: "sent",
      ...(guardada.repetido ? { repetido: true } : {}),
    });
  }

  // 071 (D6) — Con `clientMessageId`, la llave se reserva ANTES de Meta.
  let reservado: string | undefined;
  if (body.data.clientMessageId) {
    const reserva = await reservarEnvio({
      organizationId,
      conversationId: body.data.conversationId,
      clave: body.data.clientMessageId,
      text: body.data.text,
      buttons: body.data.buttons ?? null,
    });
    if (reserva.tipo === "repetido") {
      return Response.json({ messageId: reserva.messageId, repetido: true });
    }
    if (reserva.tipo === "en_curso") {
      return apiError(409, "mensaje_en_curso", "Ese mensaje se está enviando; reintenta después");
    }
    reservado = reserva.messageId;
  }

  try {
    const result = await sendText({
      conversationId: body.data.conversationId,
      organizationId,
      text: body.data.text,
      aiGenerated: true,
      ...(body.data.buttons ? { buttons: body.data.buttons } : {}),
      ...(reservado ? { reservado } : {}),
    });
    return Response.json({ messageId: result.messageId });
  } catch (err) {
    // La reserva queda fallida: el reintento del cerebro con la misma llave vuelve a intentar.
    if (reservado) {
      await marcarReservaFallida(
        organizationId,
        reservado,
        err instanceof Error ? err.message.slice(0, 500) : "error desconocido"
      ).catch(() => {});
    }
    if (err instanceof SendError) {
      if (err.code === "window_closed") {
        return apiError(409, "window_closed", err.message);
      }
      if (err.code === "sandbox_violation") {
        return apiError(409, "sandbox_violation", err.message);
      }
      // 070: la ruta ya lo contestó antes; esto es por si el canal cambia en medio.
      if (err.code === "canal_sin_botones") return apiError(409, err.code, err.message);
      if (err.code === "message_limit") {
        return apiError(409, "message_limit", err.message);
      }
      // Un texto de más de 4,096 caracteres por WhatsApp ya daba 422
      // `invalid_body` (lo cortaba el esquema): se conserva el código.
      if (err.code === "text_too_long") {
        return apiError(422, "invalid_body", err.message);
      }
      return apiError(502, err.code, err.message);
    }
    throw err;
  }
}

// 075 — Autentica el negocio y corre la ruta dentro de él (RLS).
export const POST = rutaDelCerebro(postSinNegocio);
