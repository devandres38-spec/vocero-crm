import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";

/**
 * 070 (D5; D6 de la 067) — El consentimiento vive en el CRM: registro legal
 * del negocio responsable. SOLO AGREGAR: aquí no hay `update` ni `delete`
 * sobre `consent`, y `consentimiento.test.ts` lo verifica en todo `src/`. Las
 * reglas de cuándo pedirlo son del cerebro.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const TIPOS_DE_CONSENTIMIENTO = [
  "aviso_privacidad",
  "marketing",
] as const;
export type TipoDeConsentimiento = (typeof TIPOS_DE_CONSENTIMIENTO)[number];

export const consentimientoSchema = z.object({
  conversationId: z.string().min(1),
  kind: z.enum(TIPOS_DE_CONSENTIMIENTO),
  granted: z.boolean(),
  noticeVersion: z.string().min(1).max(100),
  sourceMessageId: z.string().min(1).max(64).optional(),
});

export type ResultadoConsentimiento =
  | { ok: true; id: string; createdAt: Date }
  | { ok: false; motivo: "no_encontrada" };

/** Registra un consentimiento de una conversación del negocio. */
export async function registrarConsentimiento(
  organizationId: string,
  datos: z.infer<typeof consentimientoSchema>,
  db: Db = getDb(),
): Promise<ResultadoConsentimiento> {
  const [conv] = await db
    .select({ contactId: schema.conversation.contactId })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.id, datos.conversationId),
      ),
    )
    .limit(1);
  if (!conv) return { ok: false, motivo: "no_encontrada" };

  const [fila] = await db
    .insert(schema.consent)
    .values({
      id: newId("consent"),
      organizationId,
      contactId: conv.contactId,
      conversationId: datos.conversationId,
      kind: datos.kind,
      granted: datos.granted,
      noticeVersion: datos.noticeVersion,
      sourceMessageId: datos.sourceMessageId ?? null,
    })
    .returning({ id: schema.consent.id, createdAt: schema.consent.createdAt });
  return { ok: true, id: fila!.id, createdAt: fila!.createdAt };
}

export type ConsentimientoDto = {
  granted: boolean;
  noticeVersion: string;
  at: string;
};

/** El último consentimiento de cada tipo del contacto (para `/api/bot/context`). */
export async function consentimientoDelContacto(
  organizationId: string,
  contactId: string,
  db: Db = getDb(),
): Promise<{
  avisoPrivacidad: ConsentimientoDto | null;
  marketing: ConsentimientoDto | null;
}> {
  const ultimo = async (kind: TipoDeConsentimiento) => {
    const [fila] = await db
      .select({
        granted: schema.consent.granted,
        noticeVersion: schema.consent.noticeVersion,
        createdAt: schema.consent.createdAt,
      })
      .from(schema.consent)
      .where(
        scoped(
          schema.consent.organizationId,
          organizationId,
          and(
            eq(schema.consent.contactId, contactId),
            eq(schema.consent.kind, kind),
          ),
        ),
      )
      .orderBy(desc(schema.consent.createdAt), desc(schema.consent.id))
      .limit(1);
    return fila
      ? {
          granted: fila.granted,
          noticeVersion: fila.noticeVersion,
          at: fila.createdAt.toISOString(),
        }
      : null;
  };
  const [avisoPrivacidad, marketing] = await Promise.all([
    ultimo("aviso_privacidad"),
    ultimo("marketing"),
  ]);
  return { avisoPrivacidad, marketing };
}

/**
 * 070 (D6) — ¿El último aviso de privacidad de ESTA conversación es un
 * rechazo? Es lo único que autoriza `forget`: un error del cerebro no puede
 * vaciar una conversación ajena.
 */
export async function rechazoRegistrado(
  tx: Db | Tx,
  organizationId: string,
  conversationId: string,
): Promise<boolean> {
  const [fila] = await tx
    .select({ granted: schema.consent.granted })
    .from(schema.consent)
    .where(
      scoped(
        schema.consent.organizationId,
        organizationId,
        and(
          eq(schema.consent.conversationId, conversationId),
          eq(schema.consent.kind, "aviso_privacidad"),
        ),
      ),
    )
    .orderBy(desc(schema.consent.createdAt), desc(schema.consent.id))
    .limit(1);
  return fila?.granted === false;
}
