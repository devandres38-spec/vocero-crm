/**
 * Las URLs del proveedor de IA y lo que queda del catálogo de la vieja
 * Ajustes → IA (los tipos de `ai_credentials`, que se borra en el bloque V).
 * 080: la llave es la de Aliantis, en el entorno (`lib/ai/provider.ts`).
 */

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api";

export const AI_PROVIDERS = ["openrouter", "openai_compatible"] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];

export const AI_STATUSES = [
  "active",
  "paused_invalid_token",
  "paused_no_credit",
] as const;
export type AiStatus = (typeof AI_STATUSES)[number];

/** A qué preset corresponde una base URL (la del entorno o una guardada). */
export function presetDeBaseUrl(baseUrl: string): AiProviderId {
  return apiRoot(baseUrl) === apiRoot(OPENROUTER_BASE_URL)
    ? "openrouter"
    : "openai_compatible";
}

/**
 * La raíz `/v1` de una API OpenAI-compatible.
 *
 * La convención del repo es la base SIN `/v1` (`https://openrouter.ai/api`),
 * pero media internet publica la suya CON él (`https://api.groq.com/openai/v1`).
 * Se aceptan las dos: si ya termina en `/v1` no se duplica. Con la antigua
 * concatenación a ciegas, pegar la segunda daba `/v1/v1/chat/completions` y
 * un 404 que no explicaba nada.
 */
export function apiRoot(baseUrl: string): string {
  const sinBarra = baseUrl.trim().replace(/\/+$/, "");
  return /\/v1$/i.test(sinBarra) ? sinBarra : `${sinBarra}/v1`;
}

export function chatCompletionsUrl(baseUrl: string): string {
  return `${apiRoot(baseUrl)}/chat/completions`;
}

export function modelsUrl(baseUrl: string): string {
  return `${apiRoot(baseUrl)}/models`;
}

/** Los últimos 4 del token: lo único que viaja a la UI. */
export function last4(token: string): string {
  return token.slice(-4);
}
