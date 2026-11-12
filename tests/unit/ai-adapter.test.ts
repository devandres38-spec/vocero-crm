import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { chatJson, cuerpoHaciaProveedor, extractJson, OPENROUTER_FIJOS } from "@/lib/ai";
import { judgeCase } from "@/server/lab/judge";

/**
 * 080 — La llave es la de Aliantis (entorno). Si el adaptador volviera a tocar
 * `ai_credentials` (leer la fila o pausarla), estas marcas lo verían.
 */
const tocadas = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/server/ai/credentials", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/ai/credentials")>();
  const marca = async () => {
    tocadas.n++;
    return null;
  };
  return {
    ...original,
    getAiCredentialSecret: marca,
    getAiCredentialPublic: marca,
    marcarEstadoPorRespuesta: async () => {
      tocadas.n++;
      return true;
    },
  };
});

describe("extractJson (extracción robusta)", () => {
  it("JSON limpio", () => {
    expect(extractJson('{"action":"none"}')).toEqual({ action: "none" });
  });

  it("bloque ```json con texto alrededor", () => {
    const raw = 'Claro, aquí está:\n```json\n{"action":"reply","text":"hola"}\n```\nEspero que sirva.';
    expect(extractJson(raw)).toEqual({ action: "reply", text: "hola" });
  });

  it("JSON incrustado en prosa (primer { al último })", () => {
    const raw = 'La acción que tomaré es {"action":"handoff","reason":"cliente"} por lo dicho.';
    expect(extractJson(raw)).toEqual({ action: "handoff", reason: "cliente" });
  });

  it("sin JSON → null", () => {
    expect(extractJson("no tengo nada que decir")).toBeNull();
  });
});

describe("chatJson (reintentos y errores tipados)", () => {
  const schema = z.object({ action: z.literal("reply"), text: z.string() });

  beforeEach(() => {
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
    vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
    vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
    vi.stubEnv("OPENROUTER_MODEL", "modelo-test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    tocadas.n = 0;
  });

  function providerResponse(content: string) {
    return new Response(
      JSON.stringify({ choices: [{ message: { content } }] }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  it("salida inválida al primer intento → reintenta con STRICT y triunfa", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(providerResponse("no soy json"))
      .mockResolvedValueOnce(providerResponse('{"action":"reply","text":"ok"}'));
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatJson(schema, [{ role: "user", content: "hola" }]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.text).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // el reintento agrega la instrucción STRICT
    const secondBody = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string);
    expect(JSON.stringify(secondBody.messages)).toContain("STRICT");
  });

  it("proveedor caído (500 persistente) → error tipado, jamás excepción", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response("boom", { status: 500 }))
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatJson(schema, [{ role: "user", content: "hola" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("provider_error");
    expect(fetchMock).toHaveBeenCalledTimes(3); // agotó los 3 intentos
  });

  it("salida que nunca cumple el esquema → invalid_output", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(providerResponse('{"action":"otra_cosa"}'))
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatJson(schema, [{ role: "user", content: "hola" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_output");
  });

  it("sin token → not_configured sin tocar la red", async () => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatJson(schema, [{ role: "user", content: "hola" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ---- 080: la llave de Aliantis y los proveedores fijos ------------------

  it("hacia OpenRouter, el cuerpo lleva los proveedores fijos, ZDR y reasoning none", async () => {
    vi.stubEnv("OPENROUTER_BASE_URL", "https://openrouter.ai/api");
    vi.stubEnv("OPENROUTER_JUDGE_MODEL", "deepseek/juez");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(providerResponse('{"action":"reply","text":"ok"}'));
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatJson(schema, [{ role: "user", content: "hola" }], { judge: true });
    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer token-test" });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe("deepseek/juez");
    expect(body.reasoning).toEqual({ effort: "none" });
    expect(body.provider).toEqual({
      data_collection: "deny",
      zdr: true,
      require_parameters: true,
      only: ["deepinfra", "parasail"],
    });
  });

  it("con otra base (el mock de pruebas), el cuerpo es solo modelo y mensajes", () => {
    const msgs = [{ role: "user" as const, content: "hola" }];
    expect(cuerpoHaciaProveedor("http://localhost:3000/api/dev/ai-mock", "m", msgs)).toEqual({
      model: "m",
      messages: msgs,
    });
    expect(cuerpoHaciaProveedor("https://openrouter.ai/api/v1/", "m", msgs)).toEqual({
      model: "m",
      messages: msgs,
      ...OPENROUTER_FIJOS,
    });
  });

  it("401 con la llave de Aliantis → reintenta, provider_error y no toca ai_credentials", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response("unauthorized", { status: 401 })));
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatJson(schema, [{ role: "user", content: "hola" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("provider_error");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(tocadas.n).toBe(0);
    // El aviso del log no lleva la llave.
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("token-test");
    warn.mockRestore();
  });

  it("el juez con 402 queda judge_failed con el motivo, sin escribir en ai_credentials", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve(new Response("sin saldo", { status: 402 })))
    );
    const outcome = await judgeCase({
      personaKey: "comprador_decidido",
      transcript: [{ role: "cliente", text: "hola" }],
      kbText: "kb",
      behaviorText: "b",
    });
    expect(outcome.status).toBe("judge_failed");
    if (outcome.status === "judge_failed") expect(outcome.detail).toContain("402");
    expect(tocadas.n).toBe(0);
    vi.restoreAllMocks();
  });
});
