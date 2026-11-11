import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { olvidarPorRechazo } from "@/server/inbox/olvidar";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  conversationId: z.string().min(1),
  reason: z.literal("no_acepta"),
});

/**
 * 070 (067 §4) — «No acepto» borra: los mensajes de la conversación, sus
 * adjuntos y los eventos de webhook que los traían, y vacía la ficha. Solo si
 * el último aviso de privacidad de ESA conversación es un rechazo.
 *
 * 200 `{ deleted }` (repetirlo: `deleted: 0`) · 404 `not_found` ·
 * 409 `sin_rechazo` · 422 `invalid_body`.
 */
export async function POST(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;

  const organizationId = await resolveInstanceOrg();
  if (!organizationId) {
    return apiError(409, "no_org", "La instancia aún no tiene organización");
  }

  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const r = await olvidarPorRechazo(organizationId, body.data.conversationId);
  if (!r.ok) {
    return r.motivo === "sin_rechazo"
      ? apiError(
          409,
          "sin_rechazo",
          "No hay un rechazo del aviso de privacidad registrado",
        )
      : apiError(404, "not_found", "Conversación no encontrada");
  }
  return Response.json({ deleted: r.deleted });
}
