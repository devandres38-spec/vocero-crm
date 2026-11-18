import { apiError } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { agendaDisabledResponse, agendaEnabled } from "@/server/agenda/flag";
import { moverCitaPorElCerebro, reservarPorElCerebro } from "@/server/bot/nucleo/agenda";

export const dynamic = "force-dynamic";

/**
 * 015 — Reservar y mover citas, para quien conduce la conversación.
 *
 * CONTRATO: crear responde **201**, mover responde **200**. No es purismo: en
 * un sistema real un cliente que validaba `status === 200` dejó a TODOS los
 * leads sin poder agendar durante horas, y los mocks no lo detectaron porque
 * respondían 200. Si escribes un cliente, acepta 2xx.
 *
 * Y el sobre del error va ANIDADO (`{"error":{"code":…}}`) con `slots` como
 * hermano: un mock con la forma plana escondió el camino de re-oferta durante
 * semanas en ese mismo sistema.
 *
 * 070 — Lógica compartida con `/api/brains/agenda/book`
 * (`src/server/bot/nucleo/agenda.ts`); aquí la cita va PLANA, como siempre.
 */
export async function POST(req: Request) {
  const gate = await guard(req);
  if ("response" in gate) return gate.response;
  return reservarPorElCerebro(req, gate.organizationId, "plana");
}

export async function PATCH(req: Request) {
  const gate = await guard(req);
  if ("response" in gate) return gate.response;
  return moverCitaPorElCerebro(req, gate.organizationId, "plana");
}

/* Cancelar NO existe por esta superficie a propósito: esa decisión es del
 * dueño del negocio, no del agente. El camino es el handoff. */

type Gate = { organizationId: string } | { response: Response };

async function guard(req: Request): Promise<Gate> {
  if (!agendaEnabled()) return { response: agendaDisabledResponse() };
  const denied = requireBotKey(req);
  if (denied) return { response: denied };
  const organizationId = await resolveInstanceOrg();
  if (!organizationId) {
    return {
      response: apiError(409, "no_org", "La instancia aún no tiene organización"),
    };
  }
  return { organizationId };
}
