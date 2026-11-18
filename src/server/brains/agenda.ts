import { and, asc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { apiError, parseBody } from "@/lib/api";
import { scoped } from "@/lib/db/tenant";
import { labelInTz } from "@/lib/time/slots";
import { requireBrain, type ResultadoCerebro } from "@/server/brains/auth";
import { firmarSeleccion, leerSeleccion } from "@/server/brains/seleccion";
import { cancelBooking } from "@/server/agenda/service";
import { getSettings } from "@/server/agenda/settings";
import { modulosDeOrganizacion } from "@/server/modulos/consulta";
import { localeDeOrganizacion } from "@/server/region";

/**
 * 070 (US6, contrato §3) — La agenda de un cerebro en modo plataforma.
 *
 * La puerta es `requireBrainAgenda`: primero autentica (hace falta saber de
 * qué negocio es la petición) y después mira el módulo agenda EFECTIVO de ese
 * negocio. Apagado → **404 VACÍO** en todas las rutas: es lo que la sonda de
 * Nea (`cv_sonda`) lee como «este CRM no agenda». Encendido, una conversación
 * inexistente es 404 CON sobre (la sonda concluye «sí agenda»).
 *
 * `bookings` y `cancel` tienen la forma de la agenda v2, pero 070 no anuncia
 * `agenda_v2` en el despacho (D7: faltan recordatorios), así que Nea no las
 * llama todavía. `followup` está dormido (D8).
 */

export async function requireBrainAgenda(req: Request): Promise<ResultadoCerebro> {
  const g = await requireBrain(req);
  if (!g.ok) return g;
  if (!(await modulosDeOrganizacion(g.ambito.organizationId)).agenda) {
    return { ok: false, response: new Response(null, { status: 404 }) };
  }
  return g;
}

async function conversacionDe(organizationId: string, conversationId: string) {
  const [c] = await getDb()
    .select({ id: schema.conversation.id, contactId: schema.conversation.contactId })
    .from(schema.conversation)
    .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversationId)))
    .limit(1);
  return c ?? null;
}

/** `GET /agenda/bookings`: las citas vigentes de la conversación, con su `selectionToken`. */
export async function citasParaElCerebro(req: Request, organizationId: string, ahora: Date = new Date()): Promise<Response> {
  const conversationId = new URL(req.url).searchParams.get("conversationId");
  if (!conversationId || conversationId.length > 128) {
    return apiError(422, "invalid_body", "Falta conversationId");
  }
  const conv = await conversacionDe(organizationId, conversationId);
  if (!conv) return apiError(404, "not_found", "Conversación no encontrada");

  const filas = await getDb()
    .select({
      id: schema.booking.id,
      scheduledAt: schema.booking.scheduledAt,
      updatedAt: schema.booking.updatedAt,
    })
    .from(schema.booking)
    .where(
      scoped(
        schema.booking.organizationId,
        organizationId,
        and(
          eq(schema.booking.contactId, conv.contactId),
          eq(schema.booking.kind, "session"),
          eq(schema.booking.status, "agendada"),
          gte(schema.booking.scheduledAt, ahora)
        )
      )
    )
    .orderBy(asc(schema.booking.scheduledAt))
    .limit(20);

  const [settings, locale] = await Promise.all([getSettings(organizationId), localeDeOrganizacion(organizationId)]);
  return Response.json({
    bookings: filas.map((f) => {
      const startUtc = f.scheduledAt.toISOString();
      const revision = f.updatedAt.getTime();
      return {
        selectionToken: firmarSeleccion(organizationId, { bookingId: f.id, conversationId, revision }),
        label: labelInTz(startUtc, settings.timezone, locale),
        startUtc,
        revision,
      };
    }),
  });
}

const cancelarSchema = z.object({
  conversationId: z.string().min(1).max(128),
  selectionToken: z.string().min(1).max(512),
  confirmation: z.boolean(),
  idempotencyKey: z.string().min(16).max(128),
});

/**
 * `POST /agenda/cancel`: solo con confirmación explícita del cliente, la cita
 * elegida (token de ESTA organización y ESTA conversación, sin cambios desde
 * que se listó) y una `idempotencyKey` (`brain_operation`): repetirla devuelve
 * lo mismo sin volver a cancelar.
 */
export async function cancelarPorElCerebro(req: Request, organizationId: string): Promise<Response> {
  const body = await parseBody(req, cancelarSchema);
  if (!body.ok) return body.response;
  const { conversationId, selectionToken, confirmation, idempotencyKey } = body.data;
  if (confirmation !== true) {
    return apiError(409, "confirmation_required", "Cancela solo con la confirmación explícita del cliente");
  }

  const db = getDb();
  const [previa] = await db
    .select({ response: schema.brainOperation.response })
    .from(schema.brainOperation)
    .where(
      and(
        eq(schema.brainOperation.organizationId, organizationId),
        eq(schema.brainOperation.idempotencyKey, idempotencyKey)
      )
    )
    .limit(1);
  if (previa) return Response.json(previa.response);

  const seleccion = leerSeleccion(organizationId, selectionToken);
  if (!seleccion || seleccion.conversationId !== conversationId) {
    return apiError(404, "not_found", "Cita no encontrada");
  }
  const [cita] = await db
    .select({ id: schema.booking.id, status: schema.booking.status, updatedAt: schema.booking.updatedAt })
    .from(schema.booking)
    .where(scoped(schema.booking.organizationId, organizationId, eq(schema.booking.id, seleccion.bookingId)))
    .limit(1);
  if (!cita) return apiError(404, "not_found", "Cita no encontrada");
  if (cita.status !== "agendada" || cita.updatedAt.getTime() !== seleccion.revision) {
    return apiError(409, "stale_selection", "La cita cambió: vuelve a consultarlas antes de cancelar");
  }

  await cancelBooking({ organizationId, bookingId: cita.id });
  const respuesta = { ok: true, bookingId: cita.id };
  await db
    .insert(schema.brainOperation)
    .values({ organizationId, idempotencyKey, action: "cancel", response: respuesta })
    .onConflictDoNothing();
  return Response.json(respuesta);
}
