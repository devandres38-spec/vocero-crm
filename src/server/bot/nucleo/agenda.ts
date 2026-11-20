import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { apiError, parseBody } from "@/lib/api";
import { scoped } from "@/lib/db/tenant";
import { addDaysISO, todayInTz } from "@/lib/time/slots";
import { buildCandidateSlots, computeAvailability } from "@/server/agenda/availability";
import { getSettings } from "@/server/agenda/settings";
import { armarHuecos, daysWithAgenda } from "@/server/agenda/spread";
import { replaceOffers } from "@/server/agenda/offers";
import { createSessionBooking, rescheduleForConversation } from "@/server/agenda/service";
import { bookingErrorResponse, bookingPayload, type BookingPayload } from "@/server/agenda/http";

/**
 * 070 (D5) — La agenda de un cerebro, con la organización ya resuelta y la
 * bandera ya comprobada por quien llama (`/api/bot/*`: `AGENDA` de la
 * instancia; `/api/brains/*`: el módulo efectivo de esa organización). Ver
 * `/api/bot/availability` y `/api/bot/bookings` para el contrato.
 */

const LIMITS = {
  limit: { min: 1, max: 48, def: 12 },
  perDay: { min: 1, max: 8, def: 3 },
  days: { min: 1, max: 14, def: 5 },
};

function clamp(raw: string | null, l: { min: number; max: number; def: number }) {
  // Ausente o vacío ⇒ el default del contrato. `Number(null)` es 0, no NaN:
  // sin este corte, pedir sin parámetros daba UN hueco de UN día.
  if (raw === null || raw.trim() === "") return l.def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return l.def;
  return Math.max(l.min, Math.min(l.max, Math.round(n)));
}

/** YYYY-MM-DD que además existe en el calendario (nada de 2026-02-31). */
export function fechaValida(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Los huecos que se le ofrecen al cliente. REGISTRA la oferta: es lo que
 * después habilita la reserva.
 */
export async function huecosParaElCerebro(
  req: Request,
  organizationId: string,
  opciones: { ensayo?: { conversationId: string } } = {}
): Promise<Response> {
  const url = new URL(req.url);
  const conversationId = url.searchParams.get("conversationId");
  if (!conversationId) {
    return apiError(422, "invalid_body", "Falta conversationId");
  }
  // 074 (D9, E7) — Un ensayo solo lee huecos de SU conversación sintética.
  const ensayo = opciones.ensayo;
  if (ensayo && conversationId !== ensayo.conversationId) {
    return apiError(403, "ensayo_solo_lectura", "La ficha de ensayo es de otra conversación");
  }
  // `date` es opcional; vacío cuenta como ausente. Mal formada o inexistente
  // en el calendario (2026-02-31) → 422, nunca un 500 ni el reparto callado.
  const date = url.searchParams.get("date")?.trim() || null;
  if (date !== null && !fechaValida(date)) {
    return apiError(
      422,
      "invalid_body",
      "date debe ser una fecha real en formato YYYY-MM-DD"
    );
  }

  if (!ensayo) {
    const rows = await getDb()
      .select({ id: schema.conversation.id })
      .from(schema.conversation)
      .where(
        scoped(
          schema.conversation.organizationId,
          organizationId,
          eq(schema.conversation.id, conversationId)
        )
      )
      .limit(1);
    if (!rows[0]) return apiError(404, "not_found", "Conversación no encontrada");
  }

  const limit = clamp(url.searchParams.get("limit"), LIMITS.limit);
  const perDay = clamp(url.searchParams.get("perDay"), LIMITS.perDay);
  const days = clamp(url.searchParams.get("days"), LIMITS.days);

  const settings = await getSettings(organizationId);
  const now = new Date();
  const hoy = todayInTz(now, settings.timezone);
  // Un día fuera de lo agendable ni se calcula: no hay nada que buscar.
  const dentro =
    !date || (date >= hoy && date <= addDaysISO(hoy, settings.maxDaysAhead));
  const todos = dentro
    ? await computeAvailability(organizationId, {
        settings,
        now,
        ...(date ? { fromISO: date, toISO: date } : {}),
      })
    : [];
  const { slots, query } = armarHuecos({
    todos,
    timezone: settings.timezone,
    now,
    maxDaysAhead: settings.maxDaysAhead,
    limit,
    perDay,
    days,
    date,
    candidatosDelDia:
      date && dentro ? buildCandidateSlots(settings, date, date).length : 0,
  });

  // Reemplazo completo: la oferta vigente es siempre la última. Pero una
  // consulta por día que no encontró nada NO borra lo ya ofrecido: el cliente
  // que pregunta por el sábado y oye «ese día no abrimos» todavía puede
  // quedarse con el viernes que se le dio antes.
  // 074 (E7): un ensayo no registra oferta (su conversación no existe).
  if (!ensayo && (!date || slots.length > 0)) {
    await replaceOffers(
      organizationId,
      conversationId,
      slots.map((s) => ({ startUtc: s.startUtc, label: s.label }))
    );
  }

  return Response.json({
    slots: slots.map((s) => ({
      startUtc: s.startUtc,
      endUtc: s.endUtc,
      label: s.label,
      dayIso: s.dayIso,
      dayLabel: s.dayLabel,
      time: s.time,
    })),
    // Los días que NO están aquí no tienen agenda HASTA `query.coveredUntil`:
    // lo posterior no se revisó, y de cada día se ven hasta `query.perDay`
    // horas. Para un día concreto, se pregunta con `date`.
    diasConAgenda: daysWithAgenda(slots),
    query,
  });
}

/**
 * La forma de la cita en la respuesta. `/api/bot` la manda plana (como
 * siempre); `/api/brains` la anida en `{ok, booking}` (lo que aplana
 * `_aplanar_reserva` de Nea).
 */
export type FormaCita = "plana" | "anidada";

function cuerpoCita(p: BookingPayload, forma: FormaCita): Record<string, unknown> {
  if (forma === "plana") return p;
  return { ok: true, booking: { id: p.bookingId, ...p } };
}

// Auditoría 070 (M-11): con topes.
const reservarSchema = z.object({
  conversationId: z.string().min(1).max(128),
  startUtc: z.string().min(1).max(64),
  notes: z.string().max(1000).nullish(),
});

const moverSchema = z.object({
  conversationId: z.string().min(1).max(128),
  startUtc: z.string().min(1).max(64),
});

/**
 * Auditoría 070 (M-5): con `exigirIa`, una cita no se crea ni se mueve si un
 * humano ya tomó la conversación (una llamada tardía del cerebro llegaría al
 * calendario real). Si la conversación no existe, decide el servicio (404).
 */
async function iaPausada(organizationId: string, conversationId: string): Promise<boolean> {
  const [c] = await getDb()
    .select({ aiEnabled: schema.conversation.aiEnabled, handoffAt: schema.conversation.handoffAt })
    .from(schema.conversation)
    .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversationId)))
    .limit(1);
  return Boolean(c && (!c.aiEnabled || c.handoffAt));
}

/** Crear responde **201** (acepta 2xx en el cliente). Solo lo ofrecido. */
export async function reservarPorElCerebro(
  req: Request,
  organizationId: string,
  forma: FormaCita = "plana",
  opts: { exigirIa?: boolean } = {}
): Promise<Response> {
  const body = await parseBody(req, reservarSchema);
  if (!body.ok) return body.response;
  if (opts.exigirIa && (await iaPausada(organizationId, body.data.conversationId))) {
    return apiError(409, "ai_paused", "La IA está en pausa en esta conversación");
  }

  try {
    const result = await createSessionBooking({
      organizationId,
      conversationId: body.data.conversationId,
      startUtc: body.data.startUtc,
      notes: body.data.notes ?? null,
      source: "ai",
      // La regla innegociable: el agente solo reserva lo que ya ofreció.
      requireOffer: true,
    });
    return Response.json(cuerpoCita(bookingPayload(result), forma), { status: 201 });
  } catch (err) {
    return bookingErrorResponse(err);
  }
}

/** Mover responde **200**: no crea un recurso nuevo. */
export async function moverCitaPorElCerebro(
  req: Request,
  organizationId: string,
  forma: FormaCita = "plana",
  opts: { exigirIa?: boolean } = {}
): Promise<Response> {
  const body = await parseBody(req, moverSchema);
  if (!body.ok) return body.response;
  if (opts.exigirIa && (await iaPausada(organizationId, body.data.conversationId))) {
    return apiError(409, "ai_paused", "La IA está en pausa en esta conversación");
  }

  try {
    const result = await rescheduleForConversation({
      organizationId,
      conversationId: body.data.conversationId,
      startUtc: body.data.startUtc,
    });
    return Response.json(cuerpoCita(bookingPayload(result), forma));
  } catch (err) {
    return bookingErrorResponse(err);
  }
}
