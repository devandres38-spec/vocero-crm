import { apiError } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { moverEtapa } from "@/server/bot/nucleo/acciones";

export const dynamic = "force-dynamic";

/**
 * 038 — El cerebro mueve al lead a la etapa siguiente del pipeline.
 *
 * Solo hacia adelante y a etapas abiertas, con la herramienta `etapa`
 * encendida y la IA activa en la conversación (reglas en
 * `src/server/bot/stage.ts`). Idempotente: la etapa actual da 200 con
 * `changed: false`. Los 409 y 422 traen en el mensaje las etapas válidas,
 * para que el modelo se corrija en el mismo turno.
 *
 * 070 — Lógica compartida con `/api/brains/stage` (`src/server/bot/nucleo/`).
 */
export async function POST(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;

  const organizationId = await resolveInstanceOrg();
  if (!organizationId) {
    return apiError(409, "no_org", "La instancia aún no tiene organización");
  }
  return moverEtapa(req, organizationId);
}
