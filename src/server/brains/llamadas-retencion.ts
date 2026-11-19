import { lt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * 072-B (D14) — Retención de `brain_tool_call`: las llamadas anotadas viven
 * 30 días (suficiente para cualquier reintento de un despacho). La corre el
 * barrido de webhooks (`server/webhooks/worker.ts`), que ya purga lo suyo.
 */
export const RETENCION_LLAMADAS_MS = 30 * 24 * 60 * 60 * 1000;

export async function purgarLlamadasViejas(ahora: Date = new Date()): Promise<number> {
  const filas = await getDb()
    .delete(schema.brainToolCall)
    .where(lt(schema.brainToolCall.createdAt, new Date(ahora.getTime() - RETENCION_LLAMADAS_MS)))
    .returning({ id: schema.brainToolCall.id });
  return filas.length;
}
