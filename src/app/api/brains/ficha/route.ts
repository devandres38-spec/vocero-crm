import { withBrain } from "@/server/brains/http";
import { escribirFicha } from "@/server/bot/nucleo/acciones";

export const dynamic = "force-dynamic";

/**
 * 070 — `PUT /api/brains/ficha`: igual que `/api/bot/ficha`, en el ámbito
 * del cerebro, y con la IA en pausa → 409 `ai_paused` (auditoría 070, M-5).
 */
export const PUT = withBrain((req, ambito) => escribirFicha(req, ambito.organizationId, { exigirIa: true }));
