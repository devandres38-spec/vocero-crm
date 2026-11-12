import type { z } from "zod";
import { chatCompletionsUrl, presetDeBaseUrl } from "@/lib/ai/presets";
import { resolveAiProvider, type AiProvider } from "@/lib/ai/provider";

/**
 * Adaptador LLM OpenRouter-compatible — ÚNICA frontera con el proveedor de IA
 * (Constitución II). Regla operativa: la salida del modelo es impredecible;
 * todo consumo pasa por extracción robusta + Zod + reintentos, y un hipo del
 * proveedor jamás propaga excepción (resultado `error` tipado).
 *
 * Con quién habla lo decide `lib/ai/provider.ts`: solo la llave de Aliantis,
 * en las variables `OPENROUTER_*` del entorno (080, D20).
 *
 * Pilar 5 de Aliantis: hacia OpenRouter, toda llamada va con los proveedores
 * fijos (`deepinfra` y `parasail`), ZDR, sin guardar datos y sin razonamiento,
 * igual que el cerebro (`aliantis-brain/src/llm/openrouter-llm.ts`).
 */

/** Lo que se agrega al cuerpo cuando la base es OpenRouter (pilar 5). */
export const OPENROUTER_FIJOS = {
  reasoning: { effort: "none" },
  provider: {
    data_collection: "deny",
    zdr: true,
    require_parameters: true,
    only: ["deepinfra", "parasail"],
  },
} as const;

/** El cuerpo hacia el proveedor: con base OpenRouter, más los fijos. */
export function cuerpoHaciaProveedor(
  baseUrl: string,
  model: string,
  messages: ChatMessage[]
): Record<string, unknown> {
  return presetDeBaseUrl(baseUrl) === "openrouter"
    ? { model, messages, ...OPENROUTER_FIJOS }
    : { model, messages };
}

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatJsonResult<T> =
  | { ok: true; data: T; raw: string }
  | { ok: false; error: "not_configured" | "provider_error" | "invalid_output"; detail: string };

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

/** El proveedor contestó con un código HTTP de error. */
export class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    body: string
  ) {
    super(`proveedor respondió ${status}: ${truncate(body)}`);
    this.name = "ProviderHttpError";
  }
}

export async function chatJson<T>(
  schema: z.ZodType<T>,
  messages: ChatMessage[],
  opts?: {
    model?: string;
    judge?: boolean;
    timeoutMs?: number;
  }
): Promise<ChatJsonResult<T>> {
  const resolved = await resolveAiProvider();
  if (!resolved.ok) {
    return {
      ok: false,
      error: "not_configured",
      detail: "Sin la llave de IA de Aliantis (OPENROUTER_API_TOKEN en el entorno)",
    };
  }
  const provider = resolved.provider;
  const model =
    opts?.model ?? (opts?.judge ? provider.judgeModel : provider.model);
  if (!model?.trim()) {
    return {
      ok: false,
      error: "not_configured",
      detail: "Sin modelo configurado (OPENROUTER_MODEL en el entorno)",
    };
  }

  let lastDetail = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const attemptMessages: ChatMessage[] =
      attempt === 1
        ? messages
        : [
            ...messages,
            {
              role: "system",
              content:
                "STRICT: tu respuesta anterior no fue JSON válido según el esquema. Responde ÚNICAMENTE el objeto JSON, sin explicaciones ni markdown.",
            },
          ];
    try {
      const raw = await callProvider(
        provider,
        model,
        attemptMessages,
        opts?.timeoutMs
      );
      const extracted = extractJson(raw);
      if (extracted === null) {
        lastDetail = `sin JSON extraíble (raw=${truncate(raw)})`;
        continue;
      }
      const parsed = schema.safeParse(extracted);
      if (!parsed.success) {
        lastDetail = `no cumple el esquema: ${parsed.error.issues
          .map((i) => i.path.join(".") + " " + i.message)
          .join("; ")} (raw=${truncate(raw)})`;
        continue;
      }
      return { ok: true, data: parsed.data, raw };
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : String(err);
      /**
       * Un 401 o 402 de la llave de Aliantis no pausa nada (no hay fila del
       * negocio): se reintenta y, si sigue, el caso queda `judge_failed` con
       * el motivo. Se avisa en el log, sin la llave.
       */
      if (
        err instanceof ProviderHttpError &&
        (err.status === 401 || err.status === 402)
      ) {
        console.warn(
          `[ia] el proveedor rechazó la llave de Aliantis (${err.status}); revisa OPENROUTER_API_TOKEN y el saldo`
        );
      }
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  return {
    ok: false,
    error: lastDetail.includes("esquema") || lastDetail.includes("JSON")
      ? "invalid_output"
      : "provider_error",
    detail: lastDetail,
  };
}

async function callProvider(
  provider: AiProvider,
  model: string,
  messages: ChatMessage[],
  timeoutMs = 60_000
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(chatCompletionsUrl(provider.baseUrl), {
      method: "POST",
      headers: {
        // El token jamás se loguea; solo viaja en este header.
        Authorization: `Bearer ${provider.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(cuerpoHaciaProveedor(provider.baseUrl, model, messages)),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ProviderHttpError(res.status, text);
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new Error("respuesta del proveedor sin contenido");
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extracción robusta de JSON de una respuesta de modelo:
 * 1) bloque ```json ... ``` (o ``` ... ```), 2) el texto completo,
 * 3) del primer `{` al último `}`.
 */
export function extractJson(raw: string): unknown | null {
  const candidates: string[] = [];
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());
  candidates.push(raw.trim());
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first !== -1 && last > first) {
    candidates.push(raw.slice(first, last + 1));
  }
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      // siguiente candidato
    }
  }
  return null;
}

function truncate(s: string, n = 300): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
