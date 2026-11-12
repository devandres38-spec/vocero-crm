import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { apiError, parseBody } from "@/lib/api";
import { requireBot } from "@/server/bot/auth";
import { rutaDelCerebro } from "@/server/bot/ruta";
import { publish } from "@/server/events/bus";
import { moveLeadToStage } from "@/server/leads/stage-history";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  conversationId: z.string().min(1),
});

/**
 * Reinicio de UNA conversación del Laboratorio: IA reactivada (sale del
 * handoff) y lead de vuelta a la primera etapa. El historial del inbox NO se
 * borra: es auditoría.
 *
 * 079 (N3 de Aliantis) — Solo vale en una conversación de prueba (`is_test`).
 * Sobre una conversación real responde `409 solo_laboratorio` sin tocar nada:
 * con la llave del cerebro, una conversación que atiende una persona no puede
 * volver al bot sin que nadie lo decida. El 404 va antes que el 409.
 */
async function postSinNegocio(req: Request) {
  const auth = await requireBot(req);
  if (auth instanceof Response) return auth;

  const { organizationId } = auth;

  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const rows = await db
    .select({
      id: schema.conversation.id,
      contactId: schema.conversation.contactId,
      isTest: schema.conversation.isTest,
    })
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, body.data.conversationId)
      )
    )
    .limit(1);
  const conv = rows[0];
  if (!conv) return apiError(404, "not_found", "Conversación no encontrada");
  if (!conv.isTest) {
    return apiError(
      409,
      "solo_laboratorio",
      "El reinicio solo vale en una conversación del Laboratorio"
    );
  }

  await db
    .update(schema.conversation)
    .set({
      aiEnabled: true,
      handoffAt: null,
      handoffReason: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.conversation.id, conv.id));

  // Etapa al inicio del funnel (best-effort: sin etapas no revienta el reset).
  try {
    const stages = await db
      .select()
      .from(schema.pipelineStage)
      .where(eq(schema.pipelineStage.organizationId, organizationId));
    const first = [...stages].sort((a, b) => a.position - b.position)[0];
    const leadRows = await db
      .select({ id: schema.lead.id })
      .from(schema.lead)
      .where(
        and(
          eq(schema.lead.organizationId, organizationId),
          eq(schema.lead.contactId, conv.contactId)
        )
      )
      .limit(1);
    if (first && leadRows[0]) {
      // Por la puerta única: devolver la conversación de pruebas al inicio
      // también es un movimiento, y la bitácora tiene que poder explicar por
      // qué un lead retrocedió de etapa.
      await moveLeadToStage({
        organizationId,
        leadId: leadRows[0].id,
        toStageId: first.id,
        source: "sistema",
      });
    }
  } catch (err) {
    console.warn(`[bot/reset] reinicio de etapa falló: ${err}`);
  }

  publish(organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: conv.id } },
  });
  return Response.json({ ok: true });
}

// 075 — Autentica el negocio y corre la ruta dentro de él (RLS).
export const POST = rutaDelCerebro(postSinNegocio);
