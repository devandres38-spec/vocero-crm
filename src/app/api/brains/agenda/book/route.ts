import { withBrainAgenda } from "@/server/brains/http";
import { moverCitaPorElCerebro, reservarPorElCerebro } from "@/server/bot/nucleo/agenda";

export const dynamic = "force-dynamic";

/**
 * 070 — `POST` reserva (201) y `PATCH` mueve (200) la cita de la
 * conversación, con las reglas de `/api/bot/bookings` (solo lo ofrecido; 409
 * `slot_taken`/`slot_not_offered` con `slots`). La cita va ANIDADA:
 * `{ok:true, booking:{…}}`, que es lo que aplana Nea. Los campos de la agenda
 * v2 (`idempotencyKey`, `selectionToken`…) se ignoran: 070 no la anuncia (D7).
 * Con la IA en pausa → 409 `ai_paused` (auditoría 070, M-5).
 */
export const POST = withBrainAgenda((req, ambito) =>
  reservarPorElCerebro(req, ambito.organizationId, "anidada", { exigirIa: true })
);

export const PATCH = withBrainAgenda((req, ambito) =>
  moverCitaPorElCerebro(req, ambito.organizationId, "anidada", { exigirIa: true })
);
