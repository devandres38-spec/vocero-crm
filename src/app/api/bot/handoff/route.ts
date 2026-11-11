import { registrarTraspaso } from "@/server/avisos/avisos";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { apiError, parseBody } from "@/lib/api";
import { requireBot } from "@/server/bot/auth";
import { publish } from "@/server/events/bus";
import { toHandoffReason } from "@/server/bot/handoff";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  conversationId: z.string().min(1),
  /**
   * Texto libre a propósito: el catálogo se aplica después, con fallback
   * (ver `server/bot/handoff`). Un motivo raro no puede costar el handoff.
   */
  reason: z.string().optional(),
});

/**
 * Handoff pedido por el cerebro externo: pausa la IA y deja la conversación
 * para un humano. Idempotente — solo escribe en la transición, así que
 * reintentar no pisa la hora ni el motivo original.
 *
 * Es la misma pausa que el toggle de la bandeja, y publica el mismo evento,
 * así que la app lo ve en vivo sin refrescar.
 */
export async function POST(req: Request) {
  const auth = await requireBot(req);
  if (auth instanceof Response) return auth;

  const { organizationId } = auth;

  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const rows = await db
    .select({
      id: schema.conversation.id,
      handoffAt: schema.conversation.handoffAt,
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

  if (!conv.handoffAt) {
    const ahora = new Date();
    const reason = toHandoffReason(body.data.reason);
    await db
      .update(schema.conversation)
      .set({
        aiEnabled: false,
        handoffAt: ahora,
        handoffReason: reason,
        updatedAt: ahora,
      })
      .where(eq(schema.conversation.id, conv.id));
    publish(organizationId, {
      type: "conversation.updated",
      data: { conversation: { id: conv.id } },
    });
    // 071 (3.10): el equipo se entera por Telegram (si el negocio tiene avisos).
    await registrarTraspaso({
      organizationId,
      conversationId: conv.id,
      handoffAt: ahora,
      reason,
      esPrueba: conv.isTest,
    });
  }
  return Response.json({ ok: true });
}
