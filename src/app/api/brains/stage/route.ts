import { requireBrain } from "@/server/brains/auth";
import { moverEtapa } from "@/server/bot/nucleo/acciones";

export const dynamic = "force-dynamic";

/**
 * 070 (D3) — `POST /api/brains/stage`: igual que `/api/bot/stage`, en el
 * ámbito del cerebro. Nea en cloud la llama desde su rama 070
 * (`RUTAS["/api/bot/stage"]`); antes salía a `/api/bot/stage`, que en `multi`
 * es 404, y el agente nunca movía etapas.
 */
export async function POST(req: Request) {
  const g = await requireBrain(req);
  if (!g.ok) return g.response;
  return moverEtapa(req, g.ambito.organizationId);
}
