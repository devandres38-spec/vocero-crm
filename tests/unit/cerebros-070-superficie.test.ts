import { beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/lib/db";
import type { FakeDb } from "./helpers/fake-db";

/**
 * 070 — Bloque 2, F4: la superficie `/api/brains/*` que consume una Nea
 * `multiorg`. Aquí se prueba la forma y las reglas de cada ruta con el ámbito
 * ya autenticado (la puerta `requireBrain` tiene sus pruebas en el Bloque 1;
 * la matriz A↛B completa va en el Bloque 3).
 */

const h = vi.hoisted(() => ({
  fake: null as FakeDb | null,
  ambito: { organizationId: "org_A", slug: "clinica", deploymentId: "brn_1" },
  requireBrain: vi.fn(),
  responder: vi.fn(),
  contexto: vi.fn(),
  descargar: vi.fn(),
  ficha: vi.fn(),
  etapa: vi.fn(),
  handoff: vi.fn(),
  typing: vi.fn(),
  credencial: vi.fn(),
}));

vi.mock("@/lib/db", async (original) => {
  const { crearFakeDb } = await import("./helpers/fake-db");
  h.fake = crearFakeDb();
  return { ...(await original<typeof import("@/lib/db")>()), getDb: () => h.fake!.db };
});
vi.mock("@/server/brains/auth", () => ({ requireBrain: h.requireBrain }));
vi.mock("@/server/bot/nucleo/mensajes", async (original) => ({
  ...(await original<typeof import("@/server/bot/nucleo/mensajes")>()),
  responderComoCerebro: h.responder,
}));
vi.mock("@/server/bot/nucleo/contexto", () => ({ contextoDeConversacion: h.contexto }));
vi.mock("@/server/bot/nucleo/media", () => ({ descargarAdjunto: h.descargar }));
vi.mock("@/server/bot/nucleo/acciones", () => ({
  escribirFicha: h.ficha,
  moverEtapa: h.etapa,
  pasarAHumanoPorElCerebro: h.handoff,
  marcarEscribiendo: h.typing,
}));
vi.mock("@/server/ai/credentials", async (original) => ({
  ...(await original<typeof import("@/server/ai/credentials")>()),
  getAiCredentialSecret: h.credencial,
  marcarEstadoPorRespuesta: vi.fn(async () => {}),
}));

import { GET as contexto } from "@/app/api/brains/context/route";
import { POST as mensajes } from "@/app/api/brains/messages/route";
import { GET as media } from "@/app/api/brains/media/[mediaId]/route";
import { POST as llm } from "@/app/api/brains/llm/[...ruta]/route";
import { PUT as ficha } from "@/app/api/brains/ficha/route";
import { POST as etapa } from "@/app/api/brains/stage/route";
import { POST as handoff } from "@/app/api/brains/handoff/route";
import { POST as typing } from "@/app/api/brains/typing/route";
import { conocimientoDe, llmDelCerebro, modeloQueOye } from "@/server/brains/context";
import { hashTexto, VIGENCIA_RESPUESTA_MS } from "@/server/brains/respuestas";

const fake = () => h.fake!;
const BASE = "http://plataforma.test/api/brains";

function post(ruta: string, body: unknown): Request {
  return new Request(`${BASE}/${ruta}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  fake().reiniciar();
  vi.unstubAllEnvs();
  for (const f of [h.requireBrain, h.responder, h.contexto, h.descargar, h.ficha, h.etapa, h.handoff, h.typing, h.credencial]) {
    f.mockReset();
  }
  h.requireBrain.mockResolvedValue({ ok: true, ambito: h.ambito });
  h.credencial.mockResolvedValue(null);
});

/* ------------------------------------------------------------- puerta */

describe("todas las rutas pasan primero por requireBrain", () => {
  it("si la puerta rechaza, la ruta no hace nada más", async () => {
    h.requireBrain.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    const respuestas = await Promise.all([
      contexto(new Request(`${BASE}/context?conversationId=cv_1`)),
      mensajes(post("messages", { dispatchId: "dsp_1", conversationId: "cv_1", text: "hola" })),
      media(new Request(`${BASE}/media/123`), { params: Promise.resolve({ mediaId: "123" }) }),
      llm(post("llm/chat/completions", {}), { params: Promise.resolve({ ruta: ["chat", "completions"] }) }),
      ficha(post("ficha", {})),
      etapa(post("stage", {})),
      handoff(post("handoff", {})),
      typing(post("typing", {})),
    ]);
    expect(respuestas.map((r) => r.status)).toEqual(Array(8).fill(401));
    for (const f of [h.responder, h.contexto, h.descargar, h.ficha, h.etapa, h.handoff, h.typing]) {
      expect(f).not.toHaveBeenCalled();
    }
  });

  it("ficha, etapa, handoff y typing delegan con la organización del ÁMBITO", async () => {
    for (const f of [h.ficha, h.etapa, h.handoff, h.typing]) f.mockResolvedValue(Response.json({ ok: true }));
    await ficha(post("ficha", {}));
    await etapa(post("stage", {}));
    await handoff(post("handoff", {}));
    await typing(post("typing", {}));
    for (const f of [h.ficha, h.etapa, h.handoff, h.typing]) {
      expect(f.mock.calls[0]![1]).toBe("org_A");
    }
  });
});

/* ------------------------------------------------------------ context */

describe("GET /api/brains/context", () => {
  it("exige conversationId (no se busca por teléfono)", async () => {
    const r = await contexto(new Request(`${BASE}/context?identity=573001112233`));
    expect(r.status).toBe(422);
    expect(h.contexto).not.toHaveBeenCalled();
  });

  it("conversación que no es del ámbito → 404 con sobre", async () => {
    h.contexto.mockResolvedValue(null);
    const r = await contexto(new Request(`${BASE}/context?conversationId=cv_de_B&contextVersion=2`));
    expect(r.status).toBe(404);
    expect(await r.json()).toMatchObject({ error: { code: "not_found" } });
    expect(h.contexto).toHaveBeenCalledWith("org_A", { conversationId: "cv_de_B" });
  });

  it("cuerpo de /api/bot/context + agent, knowledge y llm (sin llave propia: llm null)", async () => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "sk-or-de-la-plataforma");
    vi.stubEnv("OPENROUTER_MODEL", "modelo/plataforma");
    h.contexto.mockResolvedValue({ contact: { id: "ct_1" }, conversation: { id: "cv_1" }, lead: null, adOrigen: null });
    fake().responder(schema.agentProfile, [
      { name: "Ana", tone: "cálido", instructions: "x", escalationRules: null, greeting: null, role: "calificador", tools: null },
    ]);
    fake().responder(schema.kbEntry, [
      { kind: "qa", question: "¿Horario?", answer: "8 a 6", content: null },
      { kind: "block", question: null, answer: null, content: "Somos una clínica" },
      { kind: "qa", question: "incompleta", answer: null, content: null },
    ]);
    const r = await contexto(new Request(`${BASE}/context?conversationId=cv_1&contextVersion=2`));
    const c = (await r.json()) as Record<string, unknown>;
    expect(r.status).toBe(200);
    expect(c.contact).toEqual({ id: "ct_1" });
    expect(c.agent).toMatchObject({ name: "Ana", tone: "cálido", role: "calificador", coordinationFollowupEnabled: false });
    expect(c.knowledge).toEqual([
      { kind: "qa", question: "¿Horario?", answer: "8 a 6" },
      { kind: "block", content: "Somos una clínica" },
    ]);
    // D6: la llave del entorno NO se ofrece en esta superficie.
    expect(c.llm).toBeNull();
    expect(JSON.stringify(c)).not.toContain("sk-or-de-la-plataforma");
  });

  it("con la llave propia (proveedor compatible): llm por /api/brains/llm, sin transcribir", async () => {
    h.credencial.mockResolvedValue({
      status: "active",
      tokenLast4: "abcd",
      statusChangedAt: null,
      baseUrl: "https://api.openai.com/v1",
      model: "modelo/del-negocio",
      token: "sk-del-negocio",
    });
    expect(await llmDelCerebro("org_A")).toEqual({ path: "/api/brains/llm", model: "modelo/del-negocio", transcribeModel: "" });
    expect(h.credencial).toHaveBeenCalledWith("org_A");
  });

  it("con llave de OpenRouter: transcribe con el modelo que oye de Nea (pagado por el negocio)", async () => {
    h.credencial.mockResolvedValue({
      status: "active",
      tokenLast4: "abcd",
      statusChangedAt: null,
      baseUrl: "https://openrouter.ai/api/v1",
      model: "z-ai/glm-4.6",
      token: "sk-or-del-negocio",
    });
    expect(await llmDelCerebro("org_A")).toEqual({
      path: "/api/brains/llm",
      model: "z-ai/glm-4.6",
      transcribeModel: "google/gemini-3.5-flash-lite",
    });
    expect(modeloQueOye("no es url")).toBe("");
  });

  it("una llave pausada del negocio no se reemplaza por la del entorno", async () => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "sk-or-de-la-plataforma");
    h.credencial.mockResolvedValue({ status: "paused_invalid_token", tokenLast4: "abcd", statusChangedAt: null, baseUrl: "x", model: "m", token: "t" });
    expect(await llmDelCerebro("org_A")).toBeNull();
  });

  it("conocimientoDe descarta entradas vacías", () => {
    expect(conocimientoDe([{ kind: "block", question: null, answer: null, content: "" }])).toEqual([]);
  });
});

/* ----------------------------------------------------------- messages */

const AHORA = Date.now();
function despacho(extra: Record<string, unknown> = {}) {
  return { conversationId: "cv_1", status: "entregado", createdAt: new Date(AHORA - 5000), brainDeploymentId: "brn_1", ...extra };
}
const CUERPO = { dispatchId: "dsp_1", conversationId: "cv_1", text: "¡Hola! ¿En qué te ayudo?" };

describe("POST /api/brains/messages", () => {
  it("sin dispatchId → 422 (el contrato lo exige)", async () => {
    const r = await mensajes(post("messages", { conversationId: "cv_1", text: "hola" }));
    expect(r.status).toBe(422);
    expect(h.responder).not.toHaveBeenCalled();
  });

  it("despacho desconocido: inexistente, de otra conversación, descartado o viejo → 422", async () => {
    const casos: unknown[][] = [
      [],
      [despacho({ conversationId: "cv_otra" })],
      [despacho({ status: "descartado" })],
      [despacho({ createdAt: new Date(AHORA - VIGENCIA_RESPUESTA_MS - 60_000) })],
    ];
    for (const filas of casos) {
      fake().reiniciar();
      fake().responder(schema.dispatch, filas);
      const r = await mensajes(post("messages", CUERPO));
      expect(r.status).toBe(422);
      expect(await r.json()).toMatchObject({ error: { code: "despacho_desconocido" } });
    }
    expect(h.responder).not.toHaveBeenCalled();
  });

  it("despacho entregado a OTRO despliegue → 409 cerebro_reasignado, sin enviar", async () => {
    fake().responder(schema.dispatch, [despacho({ brainDeploymentId: "brn_viejo" })]);
    const r = await mensajes(post("messages", CUERPO));
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ error: { code: "cerebro_reasignado" } });
    expect(h.responder).not.toHaveBeenCalled();
  });

  it("primera vez: 201, envía y anota brain_reply", async () => {
    fake().responder(schema.dispatch, [despacho()]);
    fake().responder(schema.brainReply, []);
    h.responder.mockResolvedValue({ ok: true, messageId: "msg_9", prueba: false });
    const r = await mensajes(post("messages", CUERPO));
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ ok: true, messageId: "msg_9" });
    expect(h.responder).toHaveBeenCalledWith({ organizationId: "org_A", conversationId: "cv_1", text: CUERPO.text });
    expect(fake().de(schema.brainReply, "insert")[0]!.valores).toEqual({
      organizationId: "org_A",
      dispatchId: "dsp_1",
      textHash: hashTexto(CUERPO.text),
      messageId: "msg_9",
    });
  });

  it("reintento del MISMO texto: 200 con el mismo mensaje y sin reenviar", async () => {
    fake().responder(schema.dispatch, [despacho()]);
    fake().responder(schema.brainReply, [{ messageId: "msg_9" }]);
    const r = await mensajes(post("messages", CUERPO));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, messageId: "msg_9", replayed: true });
    expect(h.responder).not.toHaveBeenCalled();
  });

  it("un despacho de antes de la columna (sin despliegue anotado) se acepta", async () => {
    fake().responder(schema.dispatch, [despacho({ brainDeploymentId: null })]);
    h.responder.mockResolvedValue({ ok: true, messageId: "msg_1", prueba: true });
    expect((await mensajes(post("messages", CUERPO))).status).toBe(201);
  });

  it("ventana cerrada → 422 fuera_de_ventana; pausa → 409 ai_paused", async () => {
    fake().responder(schema.dispatch, [despacho()]);
    h.responder.mockResolvedValue({ ok: false, code: "window_closed", message: "Ventana cerrada" });
    const a = await mensajes(post("messages", CUERPO));
    expect(a.status).toBe(422);
    expect(await a.json()).toMatchObject({ error: { code: "fuera_de_ventana" } });

    fake().responder(schema.dispatch, [despacho()]);
    h.responder.mockResolvedValue({ ok: false, code: "ai_paused", message: "Pausada" });
    const b = await mensajes(post("messages", CUERPO));
    expect(b.status).toBe(409);
    expect(await b.json()).toMatchObject({ error: { code: "ai_paused" } });
    expect(fake().de(schema.brainReply, "insert")).toHaveLength(0);
  });
});

/* -------------------------------------------------------------- media */

describe("GET /api/brains/media/{id}", () => {
  it("un adjunto que no llegó a ESTA organización → 404 sin tocar Meta", async () => {
    fake().responder(schema.mediaAsset, []);
    const r = await media(new Request(`${BASE}/media/9988`), { params: Promise.resolve({ mediaId: "9988" }) });
    expect(r.status).toBe(404);
    expect(h.descargar).not.toHaveBeenCalled();
  });

  it("el propio se descarga con la organización del ámbito", async () => {
    fake().responder(schema.mediaAsset, [{ id: "ma_1" }]);
    h.descargar.mockResolvedValue(new Response("bin", { headers: { "content-type": "image/jpeg" } }));
    const r = await media(new Request(`${BASE}/media/9988`), { params: Promise.resolve({ mediaId: "9988" }) });
    expect(r.status).toBe(200);
    expect(h.descargar).toHaveBeenCalledWith("org_A", "9988");
  });

  it("id mal formado → 422", async () => {
    const r = await media(new Request(`${BASE}/media/x`), { params: Promise.resolve({ mediaId: "../etc" }) });
    expect(r.status).toBe(422);
  });
});

/* ---------------------------------------------------------------- llm */

describe("POST /api/brains/llm — solo BYOK (D6)", () => {
  it("solo reenvía chat/completions", async () => {
    const r = await llm(post("llm/models", {}), { params: Promise.resolve({ ruta: ["models"] }) });
    expect(r.status).toBe(404);
  });

  it("sin llave propia → 402 sin_credencial aunque el entorno tenga una, y sin llamar al proveedor", async () => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "sk-or-de-la-plataforma");
    vi.stubEnv("OPENROUTER_MODEL", "modelo/plataforma");
    const espia = vi.spyOn(globalThis, "fetch");
    const r = await llm(post("llm/chat/completions", { model: "m", messages: [] }), {
      params: Promise.resolve({ ruta: ["chat", "completions"] }),
    });
    expect(r.status).toBe(402);
    expect(await r.json()).toMatchObject({ error: { code: "sin_credencial" } });
    expect(espia).not.toHaveBeenCalled();
    espia.mockRestore();
  });

  it("con la llave del negocio del ÁMBITO: la manda al proveedor del negocio", async () => {
    h.credencial.mockResolvedValue({
      status: "active",
      tokenLast4: "cio1",
      statusChangedAt: null,
      baseUrl: "https://proveedor.test/api/v1",
      model: "modelo/del-negocio",
      token: "sk-del-negocio",
    });
    const espia = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ choices: [] }), { status: 200, headers: { "content-type": "application/json" } }));
    const r = await llm(post("llm/chat/completions", { model: "modelo/del-negocio", messages: [] }), {
      params: Promise.resolve({ ruta: ["chat", "completions"] }),
    });
    expect(r.status).toBe(200);
    expect(h.credencial).toHaveBeenCalledWith("org_A");
    const [url, init] = espia.mock.calls[0]!;
    expect(String(url)).toBe("https://proveedor.test/api/v1/chat/completions");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer sk-del-negocio" });
    espia.mockRestore();
  });
});
