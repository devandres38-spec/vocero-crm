import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

/**
 * 071 (D4; D10 de la 067, §5) — El historial de una conversación para el
 * cerebro, que no guarda su propia copia: una sola retención y un solo
 * borrado. El texto es el guardado (ya filtrado). Nunca trae notas internas
 * (`conversation_note`) ni nada de otra conversación u organización.
 */

type Db = ReturnType<typeof getDb>;

export const historialSchema = z.object({
  conversationId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type MensajeDelHistorial = {
  id: string;
  at: string;
  direction: "in" | "out";
  type: string;
  text: string | null;
  origin: string | null;
  aiGenerated: boolean;
  privacyFlags?: string[];
  buttonId?: string;
  buttons?: { id: string; title: string }[];
};

export async function historialDe(
  organizationId: string,
  conversationId: string,
  limit: number,
  db: Db = getDb(),
): Promise<MensajeDelHistorial[] | null> {
  const [conv] = await db
    .select({ id: schema.conversation.id })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.id, conversationId),
      ),
    )
    .limit(1);
  if (!conv) return null;

  const filas = await db
    .select({
      id: schema.message.id,
      createdAt: schema.message.createdAt,
      waTimestamp: schema.message.waTimestamp,
      direction: schema.message.direction,
      type: schema.message.type,
      text: schema.message.text,
      origin: schema.message.origin,
      aiGenerated: schema.message.aiGenerated,
      privacyFlags: schema.message.privacyFlags,
      buttonId: schema.message.buttonId,
      buttons: schema.message.buttons,
    })
    .from(schema.message)
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        eq(schema.message.conversationId, conversationId),
      ),
    )
    .orderBy(desc(schema.message.createdAt), desc(schema.message.id))
    .limit(limit);

  // Los últimos `limit`, del más viejo al más nuevo.
  return filas.reverse().map((m) => ({
    id: m.id,
    at: (m.waTimestamp ?? m.createdAt).toISOString(),
    direction: m.direction,
    type: m.type,
    text: m.text,
    // En un entrante, `origin` es el valor por defecto de la columna: no dice nada.
    origin: m.direction === "in" ? null : m.origin,
    aiGenerated: m.aiGenerated,
    ...(m.privacyFlags?.length ? { privacyFlags: [...m.privacyFlags] } : {}),
    ...(m.buttonId ? { buttonId: m.buttonId } : {}),
    ...(m.buttons?.length ? { buttons: m.buttons } : {}),
  }));
}
