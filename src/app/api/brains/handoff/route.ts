import { requireBrain } from "@/server/brains/auth";
import { pasarAHumanoPorElCerebro } from "@/server/bot/nucleo/acciones";

export const dynamic = "force-dynamic";

/** 070 — `POST /api/brains/handoff`: igual que `/api/bot/handoff`, en el ámbito del cerebro. */
export async function POST(req: Request) {
  const g = await requireBrain(req);
  if (!g.ok) return g.response;
  return pasarAHumanoPorElCerebro(req, g.ambito.organizationId);
}
