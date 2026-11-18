import { apiError } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { marcarEscribiendo } from "@/server/bot/nucleo/acciones";

export const dynamic = "force-dynamic";

/**
 * Indicador "escribiendo…" + marcar leído el último inbound.
 * POST /api/bot/typing {conversationId}
 *
 * Best-effort por contrato: al bot JAMÁS le vale reintentar esto — si Meta
 * falla se responde 200 {ok:false} y la conversación sigue. El indicador
 * dura hasta ~25 s o hasta que llegue la respuesta real.
 *
 * 070 — Lógica compartida con `/api/brains/typing` (`src/server/bot/nucleo/`).
 */
export async function POST(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;

  const organizationId = await resolveInstanceOrg();
  if (!organizationId) {
    return apiError(409, "no_org", "La instancia aún no tiene organización");
  }
  return marcarEscribiendo(req, organizationId);
}
