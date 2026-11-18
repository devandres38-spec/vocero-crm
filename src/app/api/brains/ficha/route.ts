import { requireBrain } from "@/server/brains/auth";
import { escribirFicha } from "@/server/bot/nucleo/acciones";

export const dynamic = "force-dynamic";

/** 070 — `PUT /api/brains/ficha`: igual que `/api/bot/ficha`, en el ámbito del cerebro. */
export async function PUT(req: Request) {
  const g = await requireBrain(req);
  if (!g.ok) return g.response;
  return escribirFicha(req, g.ambito.organizationId);
}
