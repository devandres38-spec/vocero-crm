import { sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * 072-B (D14) — Retención de `brain_tool_call`: las llamadas anotadas viven
 * 30 días (suficiente para cualquier reintento de un despacho). La corre el
 * barrido de webhooks (`server/webhooks/worker.ts`), que ya purga lo suyo.
 *
 * M-2 (auditoría 072-B) — En lotes acotados y sin traer ids a memoria: un
 * borrado de miles de filas de golpe frenaba el barrido. Lo que no cabe en
 * `MAX_LOTES` se borra en la pasada siguiente.
 */
export const RETENCION_LLAMADAS_MS = 30 * 24 * 60 * 60 * 1000;
export const LOTE_PURGA = 1000;
export const MAX_LOTES = 10;

export async function purgarLlamadasViejas(ahora: Date = new Date()): Promise<number> {
  const corte = new Date(ahora.getTime() - RETENCION_LLAMADAS_MS);
  const t = schema.brainToolCall;
  let total = 0;
  for (let i = 0; i < MAX_LOTES; i++) {
    const r = await getDb().execute(
      sql`delete from ${t} where ${t.id} in (select ${t.id} from ${t} where ${t.createdAt} < ${corte} limit ${LOTE_PURGA})`
    );
    const n = Number((r as unknown as { count?: number }).count ?? 0);
    total += n;
    if (n < LOTE_PURGA) break;
  }
  return total;
}
