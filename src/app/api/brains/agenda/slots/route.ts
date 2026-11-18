import { requireBrainAgenda } from "@/server/brains/agenda";
import { huecosParaElCerebro } from "@/server/bot/nucleo/agenda";

export const dynamic = "force-dynamic";

/**
 * 070 — `GET /api/brains/agenda/slots?conversationId=…[&date][&agendaId]`.
 * Igual que `/api/bot/availability` (REGISTRA la oferta), en el ámbito del
 * cerebro. Agenda apagada en el negocio → 404 vacío (la sonda de Nea);
 * conversación inexistente → 404 con sobre.
 */
export async function GET(req: Request) {
  const g = await requireBrainAgenda(req);
  if (!g.ok) return g.response;
  return huecosParaElCerebro(req, g.ambito.organizationId);
}
