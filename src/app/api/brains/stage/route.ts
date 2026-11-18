import { withBrain } from "@/server/brains/http";
import { moverEtapa } from "@/server/bot/nucleo/acciones";

export const dynamic = "force-dynamic";

/**
 * 070 (D3) — `POST /api/brains/stage`: igual que `/api/bot/stage`, en el
 * ámbito del cerebro. Nea en cloud la llama desde su rama 070
 * (`RUTAS["/api/bot/stage"]`); antes salía a `/api/bot/stage`, que en `multi`
 * es 404, y el agente nunca movía etapas.
 */
export const POST = withBrain((req, ambito) => moverEtapa(req, ambito.organizationId));
