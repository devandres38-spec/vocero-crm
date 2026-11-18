import { apiError } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { descargarAdjunto } from "@/server/bot/nucleo/media";

export const dynamic = "force-dynamic";

/**
 * 006 (amendment 002) — Descarga de un adjunto de Meta para el bot.
 * GET /api/bot/media/{mediaId} → binario + content-type.
 *
 * El token de WhatsApp NO sale del CRM: el bot pide aquí, jamás a Meta.
 * Flujo Graph delegado al helper compartido (008): src/server/whatsapp/media.
 *
 * 070 — Lógica compartida con `/api/brains/media` (`src/server/bot/nucleo/`).
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ mediaId: string }> }
) {
  const denied = requireBotKey(req);
  if (denied) return denied;

  const organizationId = await resolveInstanceOrg();
  if (!organizationId) {
    return apiError(409, "no_org", "La instancia aún no tiene organización");
  }
  const { mediaId } = await ctx.params;
  return descargarAdjunto(organizationId, mediaId);
}
