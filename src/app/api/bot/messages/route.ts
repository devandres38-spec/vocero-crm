import { apiError, parseBody } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { cuerpoRespuestaCerebro, responderComoCerebro } from "@/server/bot/nucleo/mensajes";

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
 *
 * 070 — La lógica vive en `src/server/bot/nucleo/mensajes.ts`, compartida con
 * `/api/brains/messages`; aquí solo la forma de ESTE contrato.
 */
export async function POST(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;

  const organizationId = await resolveInstanceOrg();
  if (!organizationId) {
    return apiError(409, "no_org", "La instancia aún no tiene organización");
  }

  const body = await parseBody(req, cuerpoRespuestaCerebro);
  if (!body.ok) return body.response;

  const r = await responderComoCerebro({ organizationId, ...body.data });
  if (r.ok) {
    return r.prueba
      ? Response.json({ messageId: r.messageId, status: "sent" })
      : Response.json({ messageId: r.messageId });
  }
  switch (r.code) {
    case "not_found":
      return apiError(404, "not_found", r.message);
    // Cada código literal: `tests/unit/openapi.test.ts` los compara con el contrato.
    case "ai_paused":
      return apiError(409, "ai_paused", r.message);
    case "window_closed":
      return apiError(409, "window_closed", r.message);
    case "sandbox_violation":
      return apiError(409, "sandbox_violation", r.message);
    case "message_limit":
      return apiError(409, "message_limit", r.message);
    // Un texto de más de 4,096 caracteres por WhatsApp ya daba 422
    // `invalid_body` (lo cortaba el esquema): se conserva el código.
    case "text_too_long":
      return apiError(422, "invalid_body", r.message);
    case "send_failed":
      return apiError(502, r.detalle ?? "send_failed", r.message);
  }
}
