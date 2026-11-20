import { count, desc, eq, like } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { PREFIJO_MARCA } from "./modulo";

/**
 * 072-B — Lecturas del módulo `diagnostico`, siempre de UNA organización
 * (`scoped`). Las usan su página y su API; el núcleo no las conoce.
 */

const esMarca = like(schema.conversationNote.texto, `${PREFIJO_MARCA}%`);

export type MarcasDeConversacion = { total: number; ultima: string | null };

export async function marcasDeConversacion(
  organizationId: string,
  conversationId: string
): Promise<MarcasDeConversacion> {
  const db = getDb();
  const where = scoped(
    schema.conversationNote.organizationId,
    organizationId,
    eq(schema.conversationNote.conversationId, conversationId),
    esMarca
  );
  const [totales, ultimas] = await Promise.all([
    db.select({ total: count() }).from(schema.conversationNote).where(where),
    db
      .select({ createdAt: schema.conversationNote.createdAt })
      .from(schema.conversationNote)
      .where(where)
      .orderBy(desc(schema.conversationNote.createdAt))
      .limit(1),
  ]);
  return { total: Number(totales[0]?.total ?? 0), ultima: ultimas[0]?.createdAt.toISOString() ?? null };
}

export async function ultimasMarcas(organizationId: string, limite = 10) {
  return getDb()
    .select({
      id: schema.conversationNote.id,
      conversationId: schema.conversationNote.conversationId,
      texto: schema.conversationNote.texto,
      createdAt: schema.conversationNote.createdAt,
    })
    .from(schema.conversationNote)
    .where(scoped(schema.conversationNote.organizationId, organizationId, esMarca))
    .orderBy(desc(schema.conversationNote.createdAt))
    .limit(limite);
}
