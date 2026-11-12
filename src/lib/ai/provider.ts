import { isAiConfiguredByEnv } from "@/lib/env";
import { last4, OPENROUTER_BASE_URL } from "@/lib/ai/presets";

/**
 * Con qué proveedor de IA habla Vocero (080, D20 y D3 de Aliantis).
 *
 * Una sola llave: la del entorno (`OPENROUTER_*`), que pone Andres en el
 * despliegue y que paga Aliantis. La fila de `ai_credentials` (la vieja
 * Ajustes → IA) ya no se consulta: un negocio no puede pagar con su propia
 * llave ni con cualquier proveedor. Hoy la usa solo el juez del Laboratorio.
 *
 * La función pura `resolver` existe para probar la decisión sin entorno.
 */

export type AiProvider = {
  source: "env";
  baseUrl: string;
  model: string;
  judgeModel: string;
  token: string;
};

export type EstadoIa =
  | { activa: true; origen: "env"; last4: string }
  | { activa: false; motivo: "sin_configurar" };

export type AiResolution =
  | { ok: true; provider: AiProvider }
  | { ok: false; estado: Exclude<EstadoIa, { activa: true }> };

/**
 * La llave del entorno, o `null` sin `OPENROUTER_API_TOKEN`. El modelo puede
 * venir vacío: eso lo reporta `chatJson` como `not_configured` con su detalle.
 *
 * Se lee de `process.env` directo, no por `getEnv()`, igual que
 * `isMockEnabled()` y las banderas: preguntar si hay IA no puede depender de
 * que TODO el entorno valide (ver `server/agenda/flag.ts`). Los strings
 * vacíos cuentan como ausentes, como en `getEnv()`.
 */
export function envAiProvider(): AiProvider | null {
  if (!isAiConfiguredByEnv()) return null;
  const model = leer("OPENROUTER_MODEL") ?? "";
  return {
    source: "env",
    baseUrl: leer("OPENROUTER_BASE_URL") ?? OPENROUTER_BASE_URL,
    model,
    judgeModel: leer("OPENROUTER_JUDGE_MODEL") ?? model,
    token: leer("OPENROUTER_API_TOKEN") ?? "",
  };
}

function leer(nombre: string): string | undefined {
  const v = process.env[nombre];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

/** Pura: con la llave del entorno, esa; sin ella, sin configurar. */
export function resolver(env: AiProvider | null): AiResolution {
  if (env) return { ok: true, provider: env };
  return { ok: false, estado: { activa: false, motivo: "sin_configurar" } };
}

export async function resolveAiProvider(): Promise<AiResolution> {
  return resolver(envAiProvider());
}

export async function estadoIaDe(): Promise<EstadoIa> {
  const env = envAiProvider();
  return env
    ? { activa: true, origen: "env", last4: last4(env.token) }
    : { activa: false, motivo: "sin_configurar" };
}

/** Atajo para los sitios que solo necesitan el sí/no. */
export async function isAiConfiguredFor(): Promise<boolean> {
  return (await estadoIaDe()).activa;
}

/** El mensaje que ve el dueño cuando el Laboratorio no tiene con qué juzgar. */
export function mensajeDeEstado(estado: EstadoIa): string | null {
  if (estado.activa) return null;
  return "El Laboratorio no está disponible ahora. Avísale a Aliantis.";
}
