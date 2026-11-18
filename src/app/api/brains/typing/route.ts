import { requireBrain } from "@/server/brains/auth";
import { marcarEscribiendo } from "@/server/bot/nucleo/acciones";

export const dynamic = "force-dynamic";

/** 070 — `POST /api/brains/typing`: igual que `/api/bot/typing`, en el ámbito del cerebro. */
export async function POST(req: Request) {
  const g = await requireBrain(req);
  if (!g.ok) return g.response;
  return marcarEscribiendo(req, g.ambito.organizationId);
}
