import { withBrainAgenda } from "@/server/brains/http";
import { huecosParaElCerebro } from "@/server/bot/nucleo/agenda";

export const dynamic = "force-dynamic";

/**
 * 070 — `GET /api/brains/agenda/slots?conversationId=…[&date][&agendaId]`.
 * Igual que `/api/bot/availability` (REGISTRA la oferta), en el ámbito del
 * cerebro. Agenda apagada en el negocio → 404 vacío (la sonda de Nea);
 * conversación inexistente → 404 con sobre.
 *
 * 074 — Con ficha de ensayo (contrato brains-074 §3): la conversación tiene
 * que ser la de la ficha, no se busca en la base y la oferta NO se registra.
 */
export const GET = withBrainAgenda((req, ambito) =>
  // 074 (D9, E7): con ficha de ensayo, huecos reales sin registrar oferta y
  // solo para la conversación sintética de esa ficha.
  huecosParaElCerebro(req, ambito.organizationId, ambito.ensayo ? { ensayo: ambito.ensayo } : {})
);
