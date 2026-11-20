import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { resolveAiProviderDeOrganizacion } from "@/lib/ai/provider";
import { OPENROUTER_BASE_URL } from "@/lib/ai/presets";
import { contextoDeConversacion } from "@/server/bot/nucleo/contexto";
import { serializeBotProfile } from "@/server/bot/profile";
import { herramientasEfectivas } from "@/server/brains/herramientas";
import { modulosDeOrganizacion } from "@/server/modulos/consulta";
import { ajustesDelNegocio } from "@/server/ajustes-bot";
import { camposDeHorario, tramoHumano } from "@/server/brains/humano";
import { tituloLimpio } from "@/lib/kb";
import { kbParaElCerebro, recursosDe } from "@/server/kb";

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
 *
 * 071 (D5) — `agent.agendaEnabled`: el módulo agenda de ESE negocio (techo
 * de la instalación ∧ organización). Nea lo usa en vez de sondear; si no
 * viene (CRM 2.10), sigue con su sonda por organización.
 *
 * 072-B (FR-042) — `moduleTools`: las herramientas de los módulos encendidos
 * de ESE negocio (contrato brains-072 §3). Ausente si no hay ninguna, así que
 * un negocio sin módulos recibe exactamente el cuerpo de 2.12.
 */

/** El modelo que oye por OpenRouter (igual que `MODELO_QUE_OYE` de Nea). */
export const MODELO_QUE_OYE_OPENROUTER = "google/gemini-3.5-flash-lite";

/**
 * Auditoría 070 (B-6) — `OPENROUTER_AUDIO_MODEL` lo reemplaza sin desplegar
 * (si OpenRouter cambia el slug) mientras llega la elección por negocio.
 */
export function modeloQueOyeOpenRouter(env: Record<string, string | undefined> = process.env): string {
  const v = env.OPENROUTER_AUDIO_MODEL?.trim();
  return v && /^[\w.:/-]{3,120}$/.test(v) ? v : MODELO_QUE_OYE_OPENROUTER;
}

/** Pura: el modelo de transcripción según el proveedor de la llave. */
export function modeloQueOye(baseUrl: string, env: Record<string, string | undefined> = process.env): string {
  try {
    return new URL(baseUrl).host === new URL(OPENROUTER_BASE_URL).host ? modeloQueOyeOpenRouter(env) : "";
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
  | { kind: "qa"; question: string; answer: string; title?: string }
  | { kind: "block"; content: string; title?: string };

/**
 * Pura: las entradas del conocimiento en la forma que lee Nea.
 *
 * 074 (D8, contrato brains-074 §1) — Las apagadas no salen (por si alguien
 * pasa filas sin filtrar) y `title` va al final, solo si la entrada lo tiene:
 * sin título, el cuerpo es el de 2.14.
 */
export function conocimientoDe(
  filas: {
    kind: "qa" | "block";
    question: string | null;
    answer: string | null;
    content: string | null;
    title?: string | null;
    enabled?: boolean | null;
  }[]
): ConocimientoDelCerebro[] {
  const out: ConocimientoDelCerebro[] = [];
  for (const f of filas) {
    if (f.enabled === false) continue;
    const titulo = tituloLimpio(f.title);
    const conTitulo = titulo ? { title: titulo } : {};
    if (f.kind === "qa" && f.question && f.answer) out.push({ kind: "qa", question: f.question, answer: f.answer, ...conTitulo });
    else if (f.kind === "block" && f.content) out.push({ kind: "block", content: f.content, ...conTitulo });
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
  const [perfiles, kb, llm, modulos, ajustes, conv, resources] = await Promise.all([
    db
      .select()
      .from(schema.agentProfile)
      .where(eq(schema.agentProfile.organizationId, organizationId))
      .limit(1),
    // 074 (D8): solo lo activo, fijado primero y en el orden del dueño.
    kbParaElCerebro(organizationId),
    llmDelCerebro(organizationId),
    modulosDeOrganizacion(organizationId),
    ajustesDelNegocio(organizationId),
    db
      .select({ from: schema.conversation.humanGapFrom, to: schema.conversation.humanGapTo })
      .from(schema.conversation)
      .where(and(eq(schema.conversation.organizationId, organizationId), eq(schema.conversation.id, conversationId)))
      .limit(1),
    recursosDe(organizationId),
  ]);
  const perfil = perfiles[0];
  const extra = { coordinationFollowupEnabled: false, agendaEnabled: modulos.agenda };
  const agent = perfil ? { ...serializeBotProfile(perfil, []).profile, ...extra } : extra;

  const moduleTools = herramientasEfectivas(modulos.modules).map((e) => e.anuncio);

  // 073-B — Aditivos (contrato brains-073 §3): el tramo humano (solo hasta
  // que la IA vuelva a contestar), el horario de las personas y la
  // `temperature` que fija la plataforma.
  const humanGap = await tramoHumano(organizationId, conversationId, conv[0]?.from ?? null, conv[0]?.to ?? null);

  return {
    ...base,
    agent,
    knowledge: conocimientoDe(kb),
    llm: llm ? { ...llm, temperature: ajustes.bot.temperature } : null,
    ...(moduleTools.length > 0 ? { moduleTools } : {}),
    ...(humanGap ? { humanGap } : {}),
    ...camposDeHorario(ajustes),
    // 074 (D8, contrato brains-074 §2): enlaces verificados, omitidos si no hay.
    ...(resources.length > 0 ? { resources } : {}),
  };
}
