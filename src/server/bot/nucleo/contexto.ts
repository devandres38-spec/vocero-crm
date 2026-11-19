import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { serializeFicha } from "@/server/bot/ficha";
import { findContactByIdentity } from "@/server/inbox/identity";
import { isWindowOpen, windowRemainingMs } from "@/server/inbox/window";
import { windowMsFor } from "@/server/channels/capabilities";
import { citasParaContexto } from "@/server/agenda/context";
import { anuncioDelContacto } from "@/server/attribution/store";
import { siguientesDelLead } from "@/server/bot/stage";

/**
 * 070 (D5) — El contexto conversacional que lee un cerebro, sin
 * autenticación: la ponen `/api/bot/context` (organización de la instancia)
 * y `/api/brains/context` (la del ámbito del cerebro). El cuerpo es
 * EXACTAMENTE el de `/api/bot/context` desde la 038; ver la ruta para el
 * porqué de cada campo.
 *
 * `null` = no existe esa conversación (o esa identidad) en ESTA organización.
 */
export async function contextoDeConversacion(
  organizationId: string,
  buscar: { conversationId: string } | { identity: string }
): Promise<Record<string, unknown> | null> {
  const db = getDb();

  let contact: typeof schema.contact.$inferSelect | undefined;
  let conversation: typeof schema.conversation.$inferSelect | undefined;

  if ("conversationId" in buscar) {
    const rows = await db
      .select({ conversation: schema.conversation, contact: schema.contact })
      .from(schema.conversation)
      .innerJoin(
        schema.contact,
        eq(schema.conversation.contactId, schema.contact.id)
      )
      .where(
        and(
          eq(schema.conversation.organizationId, organizationId),
          eq(schema.conversation.id, buscar.conversationId)
        )
      )
      .limit(1);
    contact = rows[0]?.contact;
    conversation = rows[0]?.conversation;
  } else {
    contact = await findContactByIdentity(organizationId, buscar.identity);
    if (contact) {
      const convs = await db
        .select()
        .from(schema.conversation)
        .where(
          and(
            eq(schema.conversation.organizationId, organizationId),
            eq(schema.conversation.contactId, contact.id),
            eq(schema.conversation.isTest, false)
          )
        )
        .limit(1);
      conversation = convs[0];
    }
  }

  if (!contact || !conversation) return null;

  const [leadRows, booking, anuncio] = await Promise.all([
    db
      .select({ lead: schema.lead, stage: schema.pipelineStage })
      .from(schema.lead)
      .innerJoin(
        schema.pipelineStage,
        eq(schema.lead.stageId, schema.pipelineStage.id)
      )
      .where(
        and(
          eq(schema.lead.organizationId, organizationId),
          eq(schema.lead.contactId, contact.id)
        )
      )
      .limit(1),
    citasParaContexto(organizationId, contact.id),
    anuncioDelContacto(organizationId, contact.id),
  ]);
  const nextStages = leadRows[0]
    ? await siguientesDelLead(organizationId, leadRows[0].lead.stageId)
    : [];

  return {
    contact: {
      id: contact.id,
      name: contact.name,
      /** Nombre neutro (014). Preferir este en clientes nuevos. */
      identity: contact.waIdentity,
      /** Alias heredado: sigue aqui para no romper bots ya desplegados. */
      waIdentity: contact.waIdentity,
      channel: contact.channel,
      phone: contact.phone,
      ficha: serializeFicha(contact),
    },
    conversation: {
      id: conversation.id,
      aiEnabled: conversation.aiEnabled && !conversation.handoffAt,
      handoffAt: conversation.handoffAt?.toISOString() ?? null,
      windowOpen: isWindowOpen(
        conversation.lastInboundAt,
        new Date(),
        windowMsFor(conversation.channel)
      ),
      windowRemainingMs: windowRemainingMs(
        conversation.lastInboundAt,
        new Date(),
        windowMsFor(conversation.channel)
      ),
    },
    lead: leadRows[0]
      ? { id: leadRows[0].lead.id, stageName: leadRows[0].stage.name, nextStages }
      : null,
    adOrigen: anuncio
      ? {
          headline: anuncio.headline,
          body: anuncio.body,
          sourceType: anuncio.sourceType,
          sourceUrl: anuncio.sourceUrl,
          hasCtwaClid: anuncio.hasCtwaClid,
          capturedAt: anuncio.capturedAt,
        }
      : null,
    /**
     * 015 — Las citas del contacto. FALTA con la agenda apagada (o si no se
     * pudieron leer): un cerebro que no lo recibe no afirma nada sobre citas,
     * y uno que no lo lee no cambia. Aditivo.
     */
    ...(booking ? { booking } : {}),
  };
}
