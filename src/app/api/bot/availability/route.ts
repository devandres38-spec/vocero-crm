import { apiError } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { agendaDisabledResponse, agendaEnabled } from "@/server/agenda/flag";
import { huecosParaElCerebro } from "@/server/bot/nucleo/agenda";

export const dynamic = "force-dynamic";

/**
 * 015 — Los horarios que se le van a ofrecer al cliente, para quien conduce la
 * conversación.
 *
 * A diferencia de la vista del operador, esta REGISTRA la oferta: es ese
 * registro lo que después habilita la reserva. Sin él, `POST /api/bot/bookings`
 * rechaza cualquier instante.
 *
 * El catálogo reservable (`limit`) es más ancho que el menú que el agente
 * enseña: guardar solo los tres que se muestran deja al agente sin nada
 * legítimo que aceptar cuando el cliente pide otro día.
 *
 * Sin `date` es un REPARTO (hasta `perDay` horas de cada día) y `query` dice
 * hasta dónde llega. Con `date=YYYY-MM-DD` (día en la zona del negocio)
 * devuelve las horas libres de ESE día, repartidas a lo largo del día, y
 * `query.status` dice por qué no hay ninguna. Sin esto, a «¿mañana en la
 * tarde?» el cerebro solo veía las tres primeras horas de mañana y contestaba
 * que solo había mañana (`src/server/agenda/spread.ts`, `armarHuecos`).
 *
 * 070 — Lógica compartida con `/api/brains/agenda/slots`
 * (`src/server/bot/nucleo/agenda.ts`).
 */
export async function GET(req: Request) {
  // La bandera se evalúa ANTES que la llave: si esta instancia no tiene
  // agenda, el endpoint no existe — no hay nada que autenticar.
  if (!agendaEnabled()) return agendaDisabledResponse();

  const denied = requireBotKey(req);
  if (denied) return denied;

  const organizationId = await resolveInstanceOrg();
  if (!organizationId) {
    return apiError(409, "no_org", "La instancia aún no tiene organización");
  }
  return huecosParaElCerebro(req, organizationId);
}
