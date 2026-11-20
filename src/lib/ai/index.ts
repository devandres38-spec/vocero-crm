import type { z } from "zod";
import { chatCompletionsUrl } from "@/lib/ai/presets";
import {
  resolveAiProvider,
  resolveAiProviderDeOrganizacion,
  type AiProvider,
  type EstadoIa,
} from "@/lib/ai/provider";
import { marcarEstadoPorRespuesta } from "@/server/ai/credentials";

/**
 * Adaptador LLM OpenRouter-compatible — ÚNICA frontera con el proveedor de IA
 * (Constitución II). Regla operativa: la salida del modelo es impredecible;
 * todo consumo pasa por extracción robusta + Zod + reintentos, y un hipo del
 * proveedor jamás propaga excepción (resultado `error` tipado).
 *
 * Con quién habla lo decide `lib/ai/provider.ts`: la fila de Ajustes → IA de
 * la organización, y si no hay, las variables `OPENROUTER_*` del entorno.
 */

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
    /**
     * De quién es la configuración con la que se paga esta llamada. Sin ella
     * solo cuenta el entorno: no hay fila que consultar ni que pausar.
     */
    organizationId?: string;
    /**
     * 070 — Solo la llave PROPIA de esa organización, sin el respaldo
     * `OPENROUTER_*` del entorno (el juez del Laboratorio en modo plataforma:
     * la plataforma no paga las corridas de un negocio sin llave).
     */
    soloOrganizacion?: boolean;
    /** 074 (D9, FR-15) — Fija la `temperature` (el juez del Laboratorio: 0). Sin ella, la del proveedor. */
    temperature?: number;
    /**
     * 074 (D9) — Se llama una vez por intento con lo que respondió el
     * proveedor (estado, cuerpo, latencia) para registrar el uso. Nunca debe
     * lanzar; si lanza, se ignora.
     */
    onUso?: (u: { status: number; cuerpo: string; latencyMs: number; model: string }) => void;
  }
): Promise<ChatJsonResult<T>> {
  // Auditoría 070 (M-7): «solo la de la organización» sin organización no
  // puede caer al entorno: no hay a quién cobrarle, así que no se piensa.
  if (opts?.soloOrganizacion && !opts.organizationId?.trim()) {
    return { ok: false, error: "not_configured", detail: "Sin organización: no hay llave propia con qué pensar" };
  }
  const resolved = opts?.soloOrganizacion
    ? await resolveAiProviderDeOrganizacion(opts.organizationId!)
    : await resolveAiProvider(opts?.organizationId);
  if (!resolved.ok) {
    return {
      ok: false,
      error: "not_configured",
      detail: detalleNoConfigurado(resolved.estado),
    };
  }
  const provider = resolved.provider;
  const model =
    opts?.model ?? (opts?.judge ? provider.judgeModel : provider.model);
  if (!model?.trim()) {
    return {
      ok: false,
      error: "not_configured",
      detail: "Sin modelo configurado (Ajustes → IA u OPENROUTER_MODEL)",
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
        opts?.timeoutMs,
        { temperature: opts?.temperature, onUso: opts?.onUso }
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
       * El estado de la credencial lo dicta QUIEN COBRA, no la UI.
       *
       * Si el proveedor dijo 401 o 402 sobre la llave guardada en Ajustes → IA,
       * la credencial queda pausada y se deja de intentar: reintentar una
       * llave que el proveedor rechaza solo gasta tiempo, y el turno ya está
       * perdido. Un 429 o un 500 NO pausan (ver `estadoSegunRespuesta`), así
       * que ahí sí se reintenta. La llave del entorno no tiene fila que
       * pausar: ahí se reintenta como siempre.
       */
      if (
        err instanceof ProviderHttpError &&
        provider.source === "org" &&
        opts?.organizationId
      ) {
        const pausada = await marcarEstadoPorRespuesta(
          opts.organizationId,
          err.status,
          lastDetail
        ).catch(() => false);
        if (pausada) break;
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

function detalleNoConfigurado(estado: Exclude<EstadoIa, { activa: true }>): string {
  switch (estado.motivo) {
    case "sin_configurar":
      return "Sin proveedor de IA: configúralo en Ajustes → IA (u OPENROUTER_API_TOKEN en el entorno)";
    case "token_invalido":
      return `La llave de IA (…${estado.last4}) está pausada: el proveedor la rechazó`;
    case "sin_saldo":
      return `La llave de IA (…${estado.last4}) está pausada: la cuenta no tiene saldo`;
  }
}

async function callProvider(
  provider: AiProvider,
  model: string,
  messages: ChatMessage[],
  timeoutMs = 60_000,
  extra: {
    temperature?: number;
    onUso?: (u: { status: number; cuerpo: string; latencyMs: number; model: string }) => void;
  } = {}
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const inicio = Date.now();
  const usar = (status: number, cuerpo: string) => {
    try {
      extra.onUso?.({ status, cuerpo, latencyMs: Date.now() - inicio, model });
    } catch {
      // El registro de uso nunca tumba la llamada.
    }
  };
  try {
    const res = await fetch(chatCompletionsUrl(provider.baseUrl), {
      method: "POST",
      headers: {
        // El token jamás se loguea; solo viaja en este header.
        Authorization: `Bearer ${provider.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        extra.temperature === undefined ? { model, messages } : { model, messages, temperature: extra.temperature }
      ),
      signal: controller.signal,
    }).catch((err: unknown) => {
      usar(0, "");
      throw err;
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      usar(res.status, text);
      throw new ProviderHttpError(res.status, text);
    }
    const crudo = await res.text();
    usar(res.status, crudo);
    const json = JSON.parse(crudo) as {
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
