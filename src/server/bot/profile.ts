import type { schema } from "@/lib/db";
import { renderKb } from "@/server/ai/prompts";
import { herramientasEfectivas, rolDe } from "@/lib/agent-roles";

type AgentProfile = typeof schema.agentProfile.$inferSelect;
type KbEntry = typeof schema.kbEntry.$inferSelect;

/**
 * Payload del perfil del agente para un cerebro externo.
 *
 * `enabled` NO viaja: ese flag gobierna la IA in-process de Vocero; el bot
 * externo se pausa por conversación (`aiEnabled` del contexto y los handoffs),
 * no por este endpoint. `resources` nace vacío para que el shape del consumidor
 * no cambie cuando existan recursos alternativos reales.
 *
 * 034 — `role` y `tools`: qué hace el agente y con qué herramientas (las
 * claves de `src/lib/agent-roles.ts`; `escalar` siempre). Aditivas: un cerebro
 * que no las conozca las ignora y enciende todo, como antes.
 *
 * 036 — `llm`: con qué piensa el cerebro sin llave propia. 080 (P7): el proxy
 * `/api/bot/llm` está apagado y la ruta del perfil siempre manda `null`; el
 * campo se queda en el contrato para no romper a quien lo lee.
 */
export type BotLlm = { path: string; model: string } | null;

export function serializeBotProfile(profile: AgentProfile, kb: KbEntry[], llm: BotLlm = null) {
  return {
    profile: {
      name: profile.name,
      tone: profile.tone ?? null,
      instructions: profile.instructions ?? null,
      escalationRules: profile.escalationRules ?? null,
      greeting: profile.greeting ?? null,
      role: rolDe(profile.role).clave,
      tools: herramientasEfectivas(profile.tools),
    },
    kb: renderKb(kb),
    resources: [] as { label: string; url: string }[],
    llm,
  };
}
