import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/lib/db";
import type { FakeDb } from "./helpers/fake-db";

/** 074 (D9, P-10) — Observabilidad BYOK: `llm_usage`, salud del bot y Laboratorio v2. */

const h = vi.hoisted(() => ({
  fake: null as FakeDb | null,
  ejecuciones: [] as number[],
  insertRompe: false,
  session: vi.fn(),
}));

vi.mock("@/lib/db", async (original) => {
  const { crearFakeDb } = await import("./helpers/fake-db");
  h.fake = crearFakeDb();
  const base = h.fake.db;
  const db = {
    ...base,
    insert: (t: unknown) => {
      if (h.insertRompe) throw new Error("base caída");
      return base.insert(t);
    },
    execute: () => Promise.resolve({ count: h.ejecuciones.shift() ?? 0 }),
  };
  return { ...(await original<typeof import("@/lib/db")>()), getDb: () => db };
});
vi.mock("@/lib/ai/provider", async (original) => ({
  ...(await original<typeof import("@/lib/ai/provider")>()),
  resolveAiProviderDeOrganizacion: async () => ({
    ok: true,
    provider: { source: "org", baseUrl: "https://openrouter.ai/api/v1", token: "sk-negocio", model: "z-ai/glm-5.3-flash", judgeModel: "j" },
  }),
}));
vi.mock("@/server/ai/credentials", () => ({ marcarEstadoPorRespuesta: async () => false }));
vi.mock("@/lib/auth/session", async (original) => ({
  ...(await original<typeof import("@/lib/auth/session")>()),
  requireSession: h.session,
}));

import {
  dispatchIdDeCabecera,
  leerPeticion,
  LOTE_PURGA_USO,
  purgarUsoLlmViejo,
  registrarUsoLlm,
  resumirUso,
  usoDesdeRespuesta,
} from "@/server/llm-usage";
import { pensarPorElCerebro } from "@/server/bot/llm-proxy";
import { GET as SALUD } from "@/app/api/agent/health/route";

const fake = () => h.fake!;
const leer = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const esperar = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  fake().reiniciar();
  h.ejecuciones = [];
  h.insertRompe = false;
  h.session.mockResolvedValue({ userId: "u_1", organizationId: "org_a", role: "owner" });
});
afterEach(() => vi.unstubAllGlobals());

describe("lectura de `usage` (sin texto)", () => {
  it("OpenAI/OpenRouter con caché, estilo Anthropic, y basura", () => {
    expect(
      usoDesdeRespuesta(
        JSON.stringify({
          model: "z-ai/glm-5.3-flash",
          choices: [{ message: { content: "secreto del cliente" } }],
          usage: { prompt_tokens: 1200, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 1024 } },
        })
      )
    ).toEqual({ model: "z-ai/glm-5.3-flash", promptTokens: 1200, cachedTokens: 1024, completionTokens: 80 });
    expect(usoDesdeRespuesta(JSON.stringify({ usage: { prompt_tokens: 10, cache_read_input_tokens: 4 } }), "m")).toMatchObject({
      model: "m",
      cachedTokens: 4,
    });
    expect(usoDesdeRespuesta("<html>502</html>", "m")).toEqual({ model: "m", promptTokens: null, cachedTokens: null, completionTokens: null });
    expect(usoDesdeRespuesta(JSON.stringify({ usage: { prompt_tokens: -5 } })).promptTokens).toBeNull();
  });

  it("detecta audio (transcribe) y valida X-Vocero-Dispatch", () => {
    expect(leerPeticion(JSON.stringify({ model: "m", messages: [{ role: "user", content: [{ type: "input_audio" }] }] }))).toEqual({ model: "m", audio: true });
    expect(leerPeticion(JSON.stringify({ model: "m", messages: [{ role: "user", content: "hola" }] })).audio).toBe(false);
    expect(dispatchIdDeCabecera("dsp_AbC-1")).toBe("dsp_AbC-1");
    expect(dispatchIdDeCabecera("dsp 1; drop")).toBeNull();
    expect(dispatchIdDeCabecera("x".repeat(65))).toBeNull();
    expect(dispatchIdDeCabecera(null)).toBeNull();
  });
});

describe("registro best-effort", () => {
  it("un fallo de la base nunca lanza", async () => {
    h.insertRompe = true;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      registrarUsoLlm({ organizationId: "org_a", source: "turn", statusCode: 200, latencyMs: 10, model: null, promptTokens: null, cachedTokens: null, completionTokens: null })
    ).resolves.toBeUndefined();
    error.mockRestore();
  });

  it("pensarPorElCerebro registra la llamada (fuente, despacho, tokens, latencia) sin texto", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ model: "z-ai/glm-5.3-flash", choices: [{ message: { content: "hola Ana, tu cédula…" } }], usage: { prompt_tokens: 900, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 800 } } }),
          { status: 200 }
        )
      )
    );
    const r = await pensarPorElCerebro({
      organizationId: "org_a",
      ruta: "chat/completions",
      cuerpoCrudo: JSON.stringify({ model: "z-ai/glm-5.3-flash", messages: [{ role: "user", content: "mi cédula es 123" }] }),
      contentType: "application/json",
      soloOrganizacion: true,
      fuente: "ensayo",
      dispatchId: "dsp_1",
    });
    expect(r.ok).toBe(true);
    await esperar();
    const [fila] = fake().de(schema.llmUsage, "insert");
    expect(fila!.valores).toMatchObject({
      organizationId: "org_a",
      dispatchId: "dsp_1",
      source: "ensayo",
      model: "z-ai/glm-5.3-flash",
      statusCode: 200,
      promptTokens: 900,
      cachedTokens: 800,
      completionTokens: 40,
    });
    expect(JSON.stringify(fila!.valores)).not.toMatch(/cédula|hola Ana/);
  });

  it("sin respuesta del proveedor se registra con estado 0; con audio, como transcribe", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("red"))));
    await pensarPorElCerebro({
      organizationId: "org_a",
      ruta: "chat/completions",
      cuerpoCrudo: JSON.stringify({ model: "m", messages: [{ role: "user", content: [{ type: "input_audio" }] }] }),
      contentType: "application/json",
      soloOrganizacion: true,
    });
    await esperar();
    expect(fake().de(schema.llmUsage, "insert")[0]!.valores).toMatchObject({ statusCode: 0, source: "transcribe", dispatchId: null });
  });
});

describe("retención a 90 días por lotes", () => {
  it("borra en lotes hasta que uno sale incompleto", async () => {
    h.ejecuciones = [LOTE_PURGA_USO, LOTE_PURGA_USO, 5];
    expect(await purgarUsoLlmViejo(new Date("2026-11-20T00:00:00Z"))).toBe(2 * LOTE_PURGA_USO + 5);
    expect(leer("src", "server", "webhooks", "worker.ts")).toMatch(/purgarUsoLlmViejo\(ahora\)\.catch/);
  });
});

describe("salud del bot (FR-14)", () => {
  it("resumen: errores, tokens, p50 y promedio por fuente", () => {
    const r = resumirUso([
      { source: "turn", statusCode: 200, promptTokens: 100, cachedTokens: 50, completionTokens: 10, latencyMs: 1000 },
      { source: "turn", statusCode: 429, promptTokens: null, cachedTokens: null, completionTokens: null, latencyMs: 200 },
      { source: "ensayo", statusCode: 0, promptTokens: null, cachedTokens: null, completionTokens: null, latencyMs: 3000 },
    ]);
    expect(r).toMatchObject({ llamadas: 3, errores: 2, tokensEntrada: 100, tokensCache: 50, tokensSalida: 10, latenciaP50Ms: 1000, latenciaPromedioMs: 1400 });
    expect(r.porFuente).toEqual({ turn: 2, ensayo: 1 });
    expect(resumirUso([])).toMatchObject({ llamadas: 0, latenciaP50Ms: null });
  });

  it("solo dueño/admin; un tipo inventado es 422", async () => {
    h.session.mockResolvedValue({ userId: "u_2", organizationId: "org_a", role: "member" });
    expect((await SALUD(new Request("http://x/api/agent/health"))).status).toBe(403);
    h.session.mockResolvedValue({ userId: "u_1", organizationId: "org_a", role: "owner" });
    expect((await SALUD(new Request("http://x/api/agent/health?kind=chismes"))).status).toBe(422);
    fake().responder(schema.llmUsage, []);
    fake().responder(schema.botIncident, [{ id: "inc_1", kind: "sin_saldo", detail: null, count: 3, conversationId: null, firstAt: new Date(), lastAt: new Date() }]);
    const ok = await SALUD(new Request("http://x/api/agent/health?kind=sin_saldo"));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ days: 7, usage: { llamadas: 0 }, incidents: [{ id: "inc_1", kind: "sin_saldo" }] });
  });
});

describe("Laboratorio v2 (FR-15)", () => {
  it("el juez evalúa con temperature 0 y se registra como lab", () => {
    const juez = leer("src", "server", "lab", "judge.ts");
    expect(juez).toMatch(/temperature: 0,/);
    expect(juez).toMatch(/source: "lab"/);
    expect(leer("src", "lib", "ai", "index.ts")).toMatch(/\{ model, messages, temperature: extra\.temperature \}/);
  });

  it("la pantalla usa el total real de casos (sin «6» fijo)", () => {
    const cliente = leer("src", "components", "lab", "lab-client.tsx");
    expect(cliente).not.toMatch(/total: 6\b/);
    expect(cliente).not.toMatch(/\b6 clientes simulados/);
    expect(leer("src", "app", "api", "lab", "runs", "route.ts")).toMatch(/total: totalDeCasos\(runId\)/);
  });
});
