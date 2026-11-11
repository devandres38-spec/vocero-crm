import { and, eq, inArray, isNotNull, notExists, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { vaciarFicha } from "@/server/bot/ficha";
import { rechazoRegistrado } from "@/server/consent";
import { publish } from "@/server/events/bus";
import { borrarEventosDeWebhook } from "@/server/webhooks/borrar";
import { deleteMediaFile } from "@/server/whatsapp/media";

/**
 * 070 (D6; D7 de la 067) — «No acepto» borra.
 *
 * Solo con un rechazo registrado para ESTA conversación (el último aviso de
 * privacidad con `granted = false`): un error del cerebro no puede vaciar
 * una conversación ajena. Borra todos sus mensajes, los adjuntos que ya nadie
 * usa (fila y archivo), las entregas de `webhook_event` que los traían, y
 * vacía la ficha: lo que el agente aprendió sin consentimiento no se queda.
 * Conserva el contacto, la conversación vacía, el lead, sus etapas, el
 * anuncio de origen y los consentimientos.
 *
 * Idempotente: repetirlo no encuentra mensajes y devuelve `deleted: 0`.
 */
export type ResultadoOlvidar =
  | { ok: true; deleted: number }
  | { ok: false; motivo: "no_encontrada" | "sin_rechazo" };

export async function olvidarPorRechazo(
  organizationId: string,
  conversationId: string,
): Promise<ResultadoOlvidar> {
  const db = getDb();
  const archivos: string[] = [];

  const resultado = await db.transaction(
    async (tx): Promise<ResultadoOlvidar> => {
      const [conv] = await tx
        .select({
          id: schema.conversation.id,
          contactId: schema.conversation.contactId,
        })
        .from(schema.conversation)
        .where(
          scoped(
            schema.conversation.organizationId,
            organizationId,
            eq(schema.conversation.id, conversationId),
          ),
        )
        // Dos olvidos a la vez: el segundo espera y no encuentra nada.
        .for("update")
        .limit(1);
      if (!conv) return { ok: false, motivo: "no_encontrada" };
      if (!(await rechazoRegistrado(tx, organizationId, conversationId))) {
        return { ok: false, motivo: "sin_rechazo" };
      }

      const delHilo = scoped(
        schema.message.organizationId,
        organizationId,
        eq(schema.message.conversationId, conversationId),
      );
      // Se anotan ANTES de borrar: después ya no hay mensaje que diga cuáles eran.
      const mensajes = await tx
        .select({
          waMessageId: schema.message.waMessageId,
          mediaAssetId: schema.message.mediaAssetId,
        })
        .from(schema.message)
        .where(delHilo);
      const borrados = await tx
        .delete(schema.message)
        .where(delHilo)
        .returning({ id: schema.message.id });

      const candidatos = [
        ...new Set(
          mensajes
            .map((m) => m.mediaAssetId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      if (candidatos.length > 0) {
        // Solo los que ya nadie usa: la imagen de un anuncio sigue en su tarjeta.
        const sinUso = await tx
          .delete(schema.mediaAsset)
          .where(
            and(
              eq(schema.mediaAsset.organizationId, organizationId),
              inArray(schema.mediaAsset.id, candidatos),
              notExists(
                tx
                  .select({ uno: sql`1` })
                  .from(schema.message)
                  .where(eq(schema.message.mediaAssetId, schema.mediaAsset.id)),
              ),
              notExists(
                tx
                  .select({ uno: sql`1` })
                  .from(schema.adAttribution)
                  .where(
                    and(
                      isNotNull(schema.adAttribution.imageAssetId),
                      eq(
                        schema.adAttribution.imageAssetId,
                        schema.mediaAsset.id,
                      ),
                    ),
                  ),
              ),
            ),
          )
          .returning({ id: schema.mediaAsset.id });
        archivos.push(...sinUso.map((a) => a.id));
      }

      await borrarEventosDeWebhook(
        tx,
        organizationId,
        mensajes
          .map((m) => m.waMessageId)
          .filter((id): id is string => Boolean(id)),
      );
      await vaciarFicha(tx, organizationId, conv.contactId);
      await tx
        .update(schema.conversation)
        .set({ unreadCount: 0, updatedAt: new Date() })
        .where(
          scoped(
            schema.conversation.organizationId,
            organizationId,
            eq(schema.conversation.id, conversationId),
          ),
        );
      return { ok: true, deleted: borrados.length };
    },
  );

  if (!resultado.ok) return resultado;

  // Los archivos, DESPUÉS del commit (mismo criterio que `eliminar.ts`).
  if (archivos.length > 0) {
    const intentos = await Promise.allSettled(
      archivos.map((id) => deleteMediaFile(organizationId, id)),
    );
    const fallidos = intentos.filter((r) => r.status === "rejected").length;
    if (fallidos > 0) {
      console.warn(
        `[olvido] ${fallidos} de ${archivos.length} adjuntos no se pudieron borrar del volumen (${organizationId})`,
      );
    }
  }
  publish(organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: conversationId } },
  });
  return resultado;
}
