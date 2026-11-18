import { requireBrainAgenda } from "@/server/brains/agenda";
import { moverCitaPorElCerebro, reservarPorElCerebro } from "@/server/bot/nucleo/agenda";

export const dynamic = "force-dynamic";

/**
 * 070 — `POST` reserva (201) y `PATCH` mueve (200) la cita de la
 * conversación, con las reglas de `/api/bot/bookings` (solo lo ofrecido; 409
 * `slot_taken`/`slot_not_offered` con `slots`). La cita va ANIDADA:
 * `{ok:true, booking:{…}}`, que es lo que aplana Nea. Los campos de la agenda
 * v2 (`idempotencyKey`, `selectionToken`…) se ignoran: 070 no la anuncia (D7).
 */
export async function POST(req: Request) {
  const g = await requireBrainAgenda(req);
  if (!g.ok) return g.response;
  return reservarPorElCerebro(req, g.ambito.organizationId, "anidada");
}

export async function PATCH(req: Request) {
  const g = await requireBrainAgenda(req);
  if (!g.ok) return g.response;
  return moverCitaPorElCerebro(req, g.ambito.organizationId, "anidada");
}
