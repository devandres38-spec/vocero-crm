import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  apiRoot,
  chatCompletionsUrl,
  last4,
  modelsUrl,
    presetDeBaseUrl,
} from "@/lib/ai/presets";
import {
  envAiProvider,
  estadoIaDe,
  resolveAiProvider,
  resolver,
  type AiProvider,
} from "@/lib/ai/provider";
import { estadoSegunRespuesta } from "@/server/ai/credentials";

/**
 * 080 — La llave de IA es la de Aliantis, solo del entorno (D20, D3): la fila
 * de `ai_credentials` ya no se consulta. Más las reglas puras que aún viven en
 * Ajustes → IA hasta que T6 la saque del negocio.
 */

/** Si el proveedor tocara la fila, esta prueba lo vería. */
const consultas = vi.hoisted(() => ({ fila: 0 }));
vi.mock("@/server/ai/credentials", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/ai/credentials")>();
  return {
    ...original,
    getAiCredentialSecret: async () => {
      consultas.fila++;
      return null;
    },
    getAiCredentialPublic: async () => {
      consultas.fila++;
      return null;
    },
  };
});

const ENTORNO: AiProvider = {
  source: "env",
  baseUrl: "https://entorno.test",
  model: "env/modelo",
  judgeModel: "env/juez",
  token: "tok-entorno-9999",
};

describe("URLs del proveedor", () => {
  it("añade /v1 a la base del repo y no lo duplica si ya viene", () => {
    expect(apiRoot("https://openrouter.ai/api")).toBe("https://openrouter.ai/api/v1");
    expect(apiRoot("https://openrouter.ai/api/")).toBe("https://openrouter.ai/api/v1");
    expect(apiRoot("https://api.groq.com/openai/v1")).toBe("https://api.groq.com/openai/v1");
    expect(apiRoot("https://api.groq.com/openai/v1/")).toBe("https://api.groq.com/openai/v1");
    expect(chatCompletionsUrl("http://localhost:3000/api/dev/ai-mock")).toBe(
      "http://localhost:3000/api/dev/ai-mock/v1/chat/completions"
    );
    expect(modelsUrl("https://api.openai.com")).toBe("https://api.openai.com/v1/models");
  });

  it("reconoce el preset por la base URL", () => {
    expect(presetDeBaseUrl("https://openrouter.ai/api")).toBe("openrouter");
    expect(presetDeBaseUrl("https://openrouter.ai/api/v1/")).toBe("openrouter");
    expect(presetDeBaseUrl("https://api.openai.com")).toBe("openai_compatible");
  });

  it("last4 expone solo los últimos 4", () => {
    expect(last4("sk-or-abcdefgh-wxyz")).toBe("wxyz");
  });
});

describe("resolución: solo la llave del entorno (080, P4)", () => {
  it("con entorno → el entorno tal cual (con su juez aparte)", () => {
    const r = resolver(ENTORNO);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.provider).toEqual(ENTORNO);
  });

  it("sin entorno → no configurado", () => {
    expect(resolver(null)).toEqual({
      ok: false,
      estado: { activa: false, motivo: "sin_configurar" },
    });
  });
});

describe("la máquina de estados de la vieja fila (credentials.ts, hasta el bloque V)", () => {
  it("401 pausa por llave, 402 por saldo; 429 y 500 no pausan", () => {
    expect(estadoSegunRespuesta(401)).toBe("paused_invalid_token");
    expect(estadoSegunRespuesta(402)).toBe("paused_no_credit");
    expect(estadoSegunRespuesta(429)).toBeNull();
    expect(estadoSegunRespuesta(500)).toBeNull();
    expect(estadoSegunRespuesta(200)).toBeNull();
  });

});

describe("la llave del entorno", () => {
  const original = { ...process.env };

  beforeAll(() => {
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
    vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    process.env = { ...original };
  });

  it("sin OPENROUTER_API_TOKEN → null, sin validar el resto del entorno", () => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "");
    expect(envAiProvider()).toBeNull();
  });

  it("con token → proveedor del entorno; el juez cae al modelo principal", () => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "tok-entorno-9999");
    vi.stubEnv("OPENROUTER_MODEL", "env/modelo");
    const p = envAiProvider();
    expect(p).toMatchObject({
      source: "env",
      baseUrl: "https://openrouter.ai/api",
      model: "env/modelo",
      judgeModel: "env/modelo",
      token: "tok-entorno-9999",
    });
  });

  it("resolveAiProvider y estadoIaDe usan el entorno y no consultan la fila", async () => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "tok-entorno-9999");
    vi.stubEnv("OPENROUTER_MODEL", "env/modelo");
    consultas.fila = 0;
    const r = await resolveAiProvider();
    expect(r.ok && r.provider.token).toBe("tok-entorno-9999");
    expect(await estadoIaDe()).toEqual({ activa: true, origen: "env", last4: "9999" });
    expect(consultas.fila).toBe(0);
  });

  it("sin entorno → sin configurar, aunque hubiera fila guardada", async () => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "");
    consultas.fila = 0;
    expect(await estadoIaDe()).toEqual({ activa: false, motivo: "sin_configurar" });
    expect((await resolveAiProvider()).ok).toBe(false);
    expect(consultas.fila).toBe(0);
  });
});
