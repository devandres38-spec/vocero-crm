import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { publish } from "@/server/events/bus";
import { serializeMessage } from "@/server/inbox/ingest";
import { unirMarcas } from "@/server/privacy/filtrar";
import { HEALTH_OMITTED_TEXT } from "@/server/privacy/privacy-filter";
import { borrarEventosDeWebhook } from "@/server/webhooks/borrar";

/**
 * 071 (D5; 067 §4b) — La segunda red de salud en Vocero: el LLM del cerebro
 * marcó salud en un entrante que el filtro no reconoció. Solo ENTRANTES de esa
 * conversación y organización; un id que no cumple se ignora.
 *
 * El texto pasa a la frase del filtro, `privacy_flags` suma `salud`, el pie
 * del adjunto se borra y las entregas de `webhook_event` que lo traían se
 * borran. El mensaje sigue en el hilo, con su hora. Idempotente.
 */
export async function omitirPorSalud(
  organizationId: string,
  conversationId: string,
  messageIds: readonly string[]
): Promise<{ ok: true; omitted: number } | { ok: false }> {
  const db = getDb();
  const cambiados = await db.transaction(async (tx) => {
    const [conv] = await tx
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
    if (!conv) return null;

    const entrantes = await tx
      .select({
        id: schema.message.id,
        text: schema.message.text,
        privacyFlags: schema.message.privacyFlags,
        waMessageId: schema.message.waMessageId,
        mediaAssetId: schema.message.mediaAssetId,
      })
      .from(schema.message)
      .where(
        scoped(
          schema.message.organizationId,
          organizationId,
          eq(schema.message.conversationId, conversationId),
          eq(schema.message.direction, "in"),
          inArray(schema.message.id, [...new Set(messageIds)])
        )
      );

    for (const m of entrantes) {
      await tx
        .update(schema.message)
        .set({
          text: m.text === null ? null : HEALTH_OMITTED_TEXT,
          privacyFlags: unirMarcas(m.privacyFlags ?? [], ["salud"]),
        })
        .where(and(eq(schema.message.organizationId, organizationId), eq(schema.message.id, m.id)));
      if (m.mediaAssetId) {
        await tx
          .update(schema.mediaAsset)
          .set({ caption: null, updatedAt: new Date() })
          .where(
            and(
              eq(schema.mediaAsset.organizationId, organizationId),
              eq(schema.mediaAsset.id, m.mediaAssetId)
            )
          );
      }
    }
    await borrarEventosDeWebhook(
      tx,
      organizationId,
      entrantes.map((m) => m.waMessageId).filter((id): id is string => Boolean(id))
    );
    return entrantes.map((m) => m.id);
  });

  if (cambiados === null) return { ok: false };
  if (cambiados.length > 0) await avisarALaBandeja(organizationId, conversationId, cambiados);
  return { ok: true, omitted: cambiados.length };
}

/** El hilo abierto reemplaza el texto (`message.updated`) y la lista se refresca. */
async function avisarALaBandeja(
  organizationId: string,
  conversationId: string,
  ids: readonly string[]
): Promise<void> {
  const filas = await getDb()
    .select({ message: schema.message, asset: schema.mediaAsset })
    .from(schema.message)
    .leftJoin(schema.mediaAsset, eq(schema.mediaAsset.id, schema.message.mediaAssetId))
    .where(scoped(schema.message.organizationId, organizationId, inArray(schema.message.id, [...ids])));
  for (const f of filas) {
    publish(organizationId, {
      type: "message.updated",
      data: { conversationId, message: serializeMessage(f.message, f.asset) },
    });
  }
  publish(organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: conversationId } },
  });
}
