import { apiError } from "@/lib/api";
import { requireBrainAgenda } from "@/server/brains/agenda";

export const dynamic = "force-dynamic";

/**
 * 070 (D8) — `POST /api/brains/agenda/followup`: dormido. El contexto dice
 * `coordinationFollowupEnabled: false`, así que Nea no lo llama; si llegara,
 * 409 `followup_not_allowed` (el seguimiento de coordinación durable es una
 * feature propia, después de la 070).
 */
export async function POST(req: Request) {
  const g = await requireBrainAgenda(req);
  if (!g.ok) return g.response;
  return apiError(409, "followup_not_allowed", "El seguimiento de coordinación no está disponible");
}
