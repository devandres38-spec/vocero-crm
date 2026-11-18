import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { resolveAiProviderDeOrganizacion } from "@/lib/ai/provider";
import { OPENROUTER_BASE_URL } from "@/lib/ai/presets";
import { contextoDeConversacion } from "@/server/bot/nucleo/contexto";
import { serializeBotProfile } from "@/server/bot/profile";

/**
 * 070 (contrato §2.1) — El contexto que lee una Nea `multiorg`: el cuerpo de
 * `/api/bot/context` MÁS lo que en `single` viaja por `/api/bot/profile`,
 * porque en esta superficie el perfil no tiene endpoint propio
 * (`_perfil_desde_contexto` de Nea):
 *
 * - `agent`: el perfil del agente + `coordinationFollowupEnabled` (siempre
 *   `false` en 070, D8).
 * - `knowledge`: pares `qa` y bloques `block`, tal como los aplana Nea.
 * - `llm`: por dónde y con qué modelo piensa. SOLO con la llave propia del
 *   negocio (D6); sin ella, `null`, y Nea no piensa (pasa a una persona).
 *   `transcribeModel`: en `multi` Nea manda el audio DENTRO del chat por
 *   `/api/brains/llm`, así que hace falta un modelo que oiga ogg/opus (las
 *   notas de voz de WhatsApp). Con una llave de OpenRouter se usa el mismo
 *   que Nea trae para eso (`MODELO_QUE_OYE` de `nea-agent/app/config.py`),
 *   pagado con la llave del negocio. Con otro proveedor, vacío: el chat de
 *   OpenAI solo acepta wav/mp3, y Nea prefiere no transcribir antes que
 *   inventar. Elegirlo por negocio es una mejora posterior a la 070.
 */

/** El modelo que oye por OpenRouter (igual que `MODELO_QUE_OYE` de Nea). */
export const MODELO_QUE_OYE_OPENROUTER = "google/gemini-3.5-flash-lite";

/** Pura: el modelo de transcripción según el proveedor de la llave. */
export function modeloQueOye(baseUrl: string): string {
  try {
    return new URL(baseUrl).host === new URL(OPENROUTER_BASE_URL).host ? MODELO_QUE_OYE_OPENROUTER : "";
  } catch {
    return "";
  }
}

export const RUTA_LLM_CEREBRO = "/api/brains/llm";

export type LlmDelCerebro = { path: string; model: string; transcribeModel: string } | null;

export async function llmDelCerebro(organizationId: string): Promise<LlmDelCerebro> {
  const ia = await resolveAiProviderDeOrganizacion(organizationId);
  if (!ia.ok || ia.provider.source !== "org" || !ia.provider.model) return null;
  return { path: RUTA_LLM_CEREBRO, model: ia.provider.model, transcribeModel: modeloQueOye(ia.provider.baseUrl) };
}

export type ConocimientoDelCerebro =
  | { kind: "qa"; question: string; answer: string }
  | { kind: "block"; content: string };

/** Pura: las entradas del conocimiento en la forma que lee Nea. */
export function conocimientoDe(
  filas: { kind: "qa" | "block"; question: string | null; answer: string | null; content: string | null }[]
): ConocimientoDelCerebro[] {
  const out: ConocimientoDelCerebro[] = [];
  for (const f of filas) {
    if (f.kind === "qa" && f.question && f.answer) out.push({ kind: "qa", question: f.question, answer: f.answer });
    else if (f.kind === "block" && f.content) out.push({ kind: "block", content: f.content });
  }
  return out;
}

export async function contextoDelCerebro(
  organizationId: string,
  conversationId: string
): Promise<Record<string, unknown> | null> {
  const base = await contextoDeConversacion(organizationId, { conversationId });
  if (!base) return null;

  const db = getDb();
  const [perfiles, kb, llm] = await Promise.all([
    db
      .select()
      .from(schema.agentProfile)
      .where(eq(schema.agentProfile.organizationId, organizationId))
      .limit(1),
    db
      .select()
      .from(schema.kbEntry)
      .where(eq(schema.kbEntry.organizationId, organizationId))
      .orderBy(asc(schema.kbEntry.createdAt)),
    llmDelCerebro(organizationId),
  ]);
  const perfil = perfiles[0];
  const agent = perfil
    ? { ...serializeBotProfile(perfil, []).profile, coordinationFollowupEnabled: false }
    : { coordinationFollowupEnabled: false };

  return { ...base, agent, knowledge: conocimientoDe(kb), llm };
}
