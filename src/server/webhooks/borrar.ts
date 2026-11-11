import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Un id de mensaje tal como aparece dentro del payload (entre comillas), para LIKE. */
export function patronDeId(id: string): string {
  const comoJson = JSON.stringify(id);
  // `\`, `%` y `_` son especiales en LIKE (con `\` como escape por defecto).
  return `%${comoJson.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
}

/**
 * 070 (D6) — Borra las entregas guardadas en `webhook_event` que traían
 * alguno de estos mensajes (`wa_message_id`, el `mid` de Meta o el id de
 * Zernio). Busca el id entre comillas dentro del payload: el mismo id no
 * puede aparecer como parte de otro. Solo en la organización dada.
 */
export async function borrarEventosDeWebhook(
  tx: Db | Tx,
  organizationId: string,
  waMessageIds: readonly string[],
): Promise<number> {
  const ids = [...new Set(waMessageIds.filter(Boolean))];
  if (ids.length === 0) return 0;
  const patrones = sql.join(
    ids.map((id) => sql`${patronDeId(id)}`),
    sql`, `,
  );
  const borrados = await tx
    .delete(schema.webhookEvent)
    .where(
      and(
        eq(schema.webhookEvent.organizationId, organizationId),
        sql`${schema.webhookEvent.payload}::text like any (array[${patrones}])`,
      ),
    )
    .returning({ id: schema.webhookEvent.id });
  return borrados.length;
}
