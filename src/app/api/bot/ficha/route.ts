import { apiError } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { escribirFicha } from "@/server/bot/nucleo/acciones";

export const dynamic = "force-dynamic";

/**
 * Ficha de calificación del lead, escrita por un cerebro externo.
 * Merge campo a campo contra lo que ya había; `null` explícito borra la clave.
 * Devuelve la ficha COMPLETA resultante, no solo el parche, para que el bot no
 * tenga que llevar su propia copia sincronizada.
 *
 * 070 — Lógica compartida con `/api/brains/ficha` (`src/server/bot/nucleo/`).
 */
export async function PUT(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;

  const organizationId = await resolveInstanceOrg();
  if (!organizationId) {
    return apiError(409, "no_org", "La instancia aún no tiene organización");
  }
  return escribirFicha(req, organizationId);
}
