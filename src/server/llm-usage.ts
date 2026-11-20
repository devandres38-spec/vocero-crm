import { desc, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";

/**
 * 074 (D9, P-10) — Uso del modelo por negocio (BYOK): una fila por llamada,
 * con tokens de entrada / en caché / de salida, latencia y estado. Nunca el
 * texto del prompt ni de la respuesta, ni datos del cliente.
 *
 * El registro es best-effort: un fallo al escribir NO puede romper el turno
 * que ya obtuvo su respuesta del proveedor (`registrarUsoLlm` nunca lanza).
 */

export const FUENTES_LLM = ["turn", "ensayo", "lab", "transcribe"] as const;
export type FuenteLlm = (typeof FUENTES_LLM)[number];

export type UsoTokens = {
  model: string | null;
  promptTokens: number | null;
  cachedTokens: number | null;
  completionTokens: number | null;
};

const entero = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), 2_000_000_000) : null;

/**
 * Pura: lo que se puede leer del cuerpo de un `chat/completions` (OpenAI,
 * OpenRouter y compatibles). `cached_tokens` sale de
 * `usage.prompt_tokens_details.cached_tokens` (OpenAI/OpenRouter) o de
 * `usage.cache_read_input_tokens` (algunos proveedores tipo Anthropic). Un
 * cuerpo que no es JSON (un 502 en HTML) no aporta nada.
 */
export function usoDesdeRespuesta(cuerpo: string, modeloPedido: string | null = null): UsoTokens {
  const vacio: UsoTokens = { model: modeloPedido, promptTokens: null, cachedTokens: null, completionTokens: null };
  if (!cuerpo || cuerpo.length > 5_000_000) return vacio;
  try {
    const d = JSON.parse(cuerpo) as Record<string, unknown>;
    if (!d || typeof d !== "object") return vacio;
    const u = (d.usage ?? {}) as Record<string, unknown>;
    const detalles = (u.prompt_tokens_details ?? {}) as Record<string, unknown>;
    const model = typeof d.model === "string" && d.model.length <= 120 ? d.model : modeloPedido;
    return {
      model,
      promptTokens: entero(u.prompt_tokens),
      cachedTokens: entero(detalles.cached_tokens) ?? entero(u.cache_read_input_tokens),
      completionTokens: entero(u.completion_tokens),
    };
  } catch {
    return vacio;
  }
}

/** Pura: el modelo pedido y si el cuerpo trae audio (para `transcribe`). */
export function leerPeticion(cuerpo: string): { model: string | null; audio: boolean } {
  try {
    const d = JSON.parse(cuerpo) as { model?: unknown; messages?: unknown };
    const model = typeof d.model === "string" && d.model.length <= 120 ? d.model : null;
    const audio =
      Array.isArray(d.messages) &&
      d.messages.some(
        (m) =>
          m &&
          typeof m === "object" &&
          Array.isArray((m as { content?: unknown }).content) &&
          ((m as { content: unknown[] }).content as unknown[]).some(
            (p) => p && typeof p === "object" && (p as { type?: unknown }).type === "input_audio"
          )
      );
    return { model, audio };
  } catch {
    return { model: null, audio: false };
  }
}

/** Pura: el `dispatchId` de la cabecera `X-Vocero-Dispatch`, solo si tiene forma de id. */
export function dispatchIdDeCabecera(valor: string | null | undefined): string | null {
  const v = (valor ?? "").trim();
  return /^[\w-]{1,64}$/.test(v) ? v : null;
}

export type RegistroUso = UsoTokens & {
  organizationId: string;
  dispatchId?: string | null;
  source: FuenteLlm;
  statusCode: number;
  latencyMs: number;
};

export async function registrarUsoLlm(r: RegistroUso): Promise<void> {
  try {
    await getDb()
      .insert(schema.llmUsage)
      .values({
        id: newId("llmUsage"),
        organizationId: r.organizationId,
        dispatchId: r.dispatchId ?? null,
        source: r.source,
        model: r.model,
        statusCode: Math.max(0, Math.min(999, Math.round(r.statusCode))),
        promptTokens: r.promptTokens,
        cachedTokens: r.cachedTokens,
        completionTokens: r.completionTokens,
        latencyMs: Math.max(0, Math.round(r.latencyMs)),
      });
  } catch (err) {
    console.error("[llm-usage] no pude registrar el uso:", err instanceof Error ? err.message : err);
  }
}

// ── Retención (90 días, por lotes) ─────────────────────────────────────────

export const RETENCION_USO_MS = 90 * 24 * 60 * 60 * 1000;
export const LOTE_PURGA_USO = 1000;
export const MAX_LOTES_USO = 10;

export async function purgarUsoLlmViejo(ahora: Date = new Date()): Promise<number> {
  const corte = new Date(ahora.getTime() - RETENCION_USO_MS);
  const t = schema.llmUsage;
  let total = 0;
  for (let i = 0; i < MAX_LOTES_USO; i++) {
    const r = await getDb().execute(
      sql`delete from ${t} where ${t.id} in (select ${t.id} from ${t} where ${t.createdAt} < ${corte} limit ${LOTE_PURGA_USO})`
    );
    const n = Number((r as unknown as { count?: number }).count ?? 0);
    total += n;
    if (n < LOTE_PURGA_USO) break;
  }
  return total;
}

// ── Resumen para el panel de salud ─────────────────────────────────────────

export type FilaUso = {
  source: string;
  statusCode: number;
  promptTokens: number | null;
  cachedTokens: number | null;
  completionTokens: number | null;
  latencyMs: number;
};

export type ResumenUso = {
  llamadas: number;
  errores: number;
  tokensEntrada: number;
  tokensCache: number;
  tokensSalida: number;
  latenciaP50Ms: number | null;
  latenciaPromedioMs: number | null;
  porFuente: Record<string, number>;
};

/** Pura: el resumen de un conjunto de filas. Error = sin respuesta o ≥400. */
export function resumirUso(filas: FilaUso[]): ResumenUso {
  const latencias = filas.map((f) => f.latencyMs).sort((a, b) => a - b);
  const porFuente: Record<string, number> = {};
  for (const f of filas) porFuente[f.source] = (porFuente[f.source] ?? 0) + 1;
  const suma = (k: "promptTokens" | "cachedTokens" | "completionTokens") =>
    filas.reduce((s, f) => s + (f[k] ?? 0), 0);
  return {
    llamadas: filas.length,
    errores: filas.filter((f) => f.statusCode === 0 || f.statusCode >= 400).length,
    tokensEntrada: suma("promptTokens"),
    tokensCache: suma("cachedTokens"),
    tokensSalida: suma("completionTokens"),
    latenciaP50Ms: latencias.length ? latencias[Math.floor((latencias.length - 1) / 2)]! : null,
    latenciaPromedioMs: latencias.length
      ? Math.round(latencias.reduce((s, x) => s + x, 0) / latencias.length)
      : null,
    porFuente,
  };
}

/** Máximo de filas que se leen para el resumen (7 días de un negocio activo caben de sobra). */
export const MAX_FILAS_RESUMEN = 20_000;

export async function resumenDeUso(organizationId: string, dias = 7, ahora: Date = new Date()): Promise<ResumenUso> {
  const desde = new Date(ahora.getTime() - dias * 24 * 60 * 60 * 1000);
  const t = schema.llmUsage;
  const filas = await getDb()
    .select({
      source: t.source,
      statusCode: t.statusCode,
      promptTokens: t.promptTokens,
      cachedTokens: t.cachedTokens,
      completionTokens: t.completionTokens,
      latencyMs: t.latencyMs,
    })
    .from(t)
    .where(scoped(t.organizationId, organizationId, gte(t.createdAt, desde)))
    .orderBy(desc(t.createdAt))
    .limit(MAX_FILAS_RESUMEN);
  return resumirUso(filas);
}

/** Los incidentes recientes del bot de ESTE negocio (073-A), con filtro por tipo. */
export async function incidentesRecientes(organizationId: string, kind: string | null, limite = 50) {
  const t = schema.botIncident;
  return getDb()
    .select({
      id: t.id,
      kind: t.kind,
      detail: t.detail,
      count: t.count,
      conversationId: t.conversationId,
      firstAt: t.firstAt,
      lastAt: t.lastAt,
    })
    .from(t)
    .where(
      kind
        ? scoped(t.organizationId, organizationId, eq(t.kind, kind as (typeof t.kind.enumValues)[number]))
        : scoped(t.organizationId, organizationId)
    )
    .orderBy(desc(t.lastAt))
    .limit(Math.max(1, Math.min(200, limite)));
}

