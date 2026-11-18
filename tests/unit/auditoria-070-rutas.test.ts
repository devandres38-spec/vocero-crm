import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { schema } from "@/lib/db";
import type { FakeDb } from "./helpers/fake-db";

/**
 * Auditoría 070 (AUDITORIA-070.md) — Regresión de las rutas `/api/brains/*`
 * y de los servicios que tocan: A-4, A-6, A-7, A-8, A-9, A-10, M-4, M-5, M-6,
 * M-7, M-10, M-11, B-2, B-3, B-5, B-6.
 */

const h = vi.hoisted(() => ({
  fake: null as FakeDb | null,
  ambito: { organizationId: "org_A", slug: "clinica", deploymentId: "brn_1" },
  responder: vi.fn(),
  contexto: vi.fn(),
  crearCita: vi.fn(),
  cancelarCita: vi.fn(),
  credencial: vi.fn(),
}));

vi.mock("@/lib/db", async (original) => {
  const { crearFakeDb } = await import("./helpers/fake-db");
  h.fake = crearFakeDb();
  return { ...(await original<typeof import("@/lib/db")>()), getDb: () => h.fake!.db };
});
vi.mock("@/lib/env", async (original) => ({
  ...(await original<typeof import("@/lib/env")>()),
  getEnv: () => ({ ENCRYPTION_KEY: Buffer.alloc(32, 4).toString("base64"), BETTER_AUTH_SECRET: "b".repeat(40) }),
}));
vi.mock("@/server/brains/auth", async (original) => ({
  ...(await original<typeof import("@/server/brains/auth")>()),
  requireBrain: async () => ({ ok: true, ambito: h.ambito }),
}));
vi.mock("@/server/modulos/consulta", async (original) => ({
  ...(await original<typeof import("@/server/modulos/consulta")>()),
  modulosDeOrganizacion: async () => ({ agenda: true, atribucion: false, channels: ["whatsapp"], modules: [] }),
}));
vi.mock("@/server/bot/nucleo/mensajes", async (original) => ({
  ...(await original<typeof import("@/server/bot/nucleo/mensajes")>()),
  responderComoCerebro: h.responder,
}));
vi.mock("@/server/brains/context", async (original) => ({
  ...(await original<typeof import("@/server/brains/context")>()),
  contextoDelCerebro: h.contexto,
}));
vi.mock("@/server/agenda/service", async (original) => ({
  ...(await original<typeof import("@/server/agenda/service")>()),
  createSessionBooking: h.crearCita,
  cancelBooking: h.cancelarCita,
}));
vi.mock("@/server/ai/credentials", async (original) => ({
  ...(await original<typeof import("@/server/ai/credentials")>()),
  getAiCredentialSecret: h.credencial,
  marcarEstadoPorRespuesta: vi.fn(),
}));
vi.mock("@/server/brains/red", async (original) => ({
  ...(await original<typeof import("@/server/brains/red")>()),
  verificarDestino: async () => null,
}));

import { GET as contexto } from "@/app/api/brains/context/route";
import { POST as mensajes } from "@/app/api/brains/messages/route";
import { PUT as ficha } from "@/app/api/brains/ficha/route";
import { POST as llm } from "@/app/api/brains/llm/[...ruta]/route";
import { POST as reservar } from "@/app/api/brains/agenda/book/route";
import { POST as cancelar } from "@/app/api/brains/agenda/cancel/route";
import { BookingError } from "@/server/agenda/service";
import { aplicarCerebro } from "@/server/platform/blueprint/secciones/cerebro";
import { buscarOrganizacion } from "@/server/platform/blueprint/aplicar";
import { configDespachoPara } from "@/server/brains/destino";
import { avisarOlvido } from "@/server/brains/deliver";
import { construirEventoOlvido } from "@/server/brains/contract";
import { firmarSeleccion, leerSeleccion, VIDA_SELECCION_MS } from "@/server/brains/seleccion";
import { MODELO_QUE_OYE_OPENROUTER, modeloQueOyeOpenRouter } from "@/server/brains/context";
import { chatJson } from "@/lib/ai";

const fake = () => h.fake!;
const BASE = "http://plataforma.test/api/brains";
const AHORA = Date.now();

function post(ruta: string, body: unknown, cabeceras: Record<string, string> = {}): Request {
  return new Request(`${BASE}/${ruta}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...cabeceras },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function despacho(extra: Record<string, unknown> = {}) {
  return { conversationId: "cv_1", status: "entregado", createdAt: new Date(AHORA - 5000), brainDeploymentId: "brn_1", ...extra };
}
const CUERPO = { dispatchId: "dsp_1", conversationId: "cv_1", text: "Hola" };

beforeEach(() => {
  fake().reiniciar();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const f of [h.responder, h.contexto, h.crearCita, h.cancelarCita, h.credencial]) f.mockReset();
  h.credencial.mockResolvedValue(null);
});

/* ------------------------------------------------------------------ A-4 */

describe("A-4 — dos reintentos simultáneos del mismo texto envían UNA vez", () => {
  it("el candado serializa: el primero envía (201), el segundo re-entrega (200)", async () => {
    const db = fake().db;
    // El candado de Postgres, emulado: las transacciones van en fila.
    let cola: Promise<unknown> = Promise.resolve();
    vi.spyOn(db, "transaction").mockImplementation((async (fn: (tx: unknown) => Promise<unknown>) => {
      const turno = cola.then(() => fn(db));
      cola = turno.catch(() => {});
      return turno;
    }) as never);
    // `brain_reply` dinámico: lo que se inserta se ve en la siguiente lectura.
    const anotadas: { messageId: string }[] = [];
    const selectOriginal = db.select;
    vi.spyOn(db, "select").mockImplementation(((...a: unknown[]) => {
      const b = (selectOriginal as (...x: unknown[]) => Record<string, unknown>)(...a);
      const fromOriginal = b.from as (t: unknown) => unknown;
      b.from = (t: unknown) =>
        t === schema.brainReply ? { where: () => ({ limit: async () => anotadas.slice(0, 1) }) } : fromOriginal(t);
      return b;
    }) as never);
    const insertOriginal = db.insert;
    vi.spyOn(db, "insert").mockImplementation(((t: unknown) => {
      if (t !== schema.brainReply) return (insertOriginal as (x: unknown) => unknown)(t);
      return {
        values: (v: { messageId: string }) => {
          anotadas.push({ messageId: v.messageId });
          return { onConflictDoNothing: async () => {} };
        },
      };
    }) as never);
    const execute = vi.spyOn(db, "execute");

    fake().responder(schema.dispatch, [despacho()]);
    fake().responder(schema.dispatch, [despacho()]);
    h.responder.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20)); // el envío a Meta tarda
      return { ok: true, messageId: "msg_1", prueba: false };
    });

    const [a, b] = await Promise.all([mensajes(post("messages", CUERPO)), mensajes(post("messages", CUERPO))]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(h.responder).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(2); // el pg_advisory_xact_lock de cada una
  });
});

/* ------------------------------------------------------------------ A-6 */

describe("A-6 — solo despachos entregados a ESTE cerebro", () => {
  it.each(["pendiente", "caducado_a_humano", "descartado"])("estado %s → 422 despacho_desconocido", async (status) => {
    fake().responder(schema.dispatch, [despacho({ status })]);
    const r = await mensajes(post("messages", CUERPO));
    expect(r.status).toBe(422);
    expect(await r.json()).toMatchObject({ error: { code: "despacho_desconocido" } });
    expect(h.responder).not.toHaveBeenCalled();
  });

  it("en_vuelo con el despliegue correcto sí se acepta", async () => {
    fake().responder(schema.dispatch, [despacho({ status: "en_vuelo" })]);
    h.responder.mockResolvedValue({ ok: true, messageId: "msg_2", prueba: false });
    expect((await mensajes(post("messages", CUERPO))).status).toBe(201);
  });
});

/* ------------------------------------------------------------------ A-7 */

describe("A-7 — un error no controlado es 500 con sobre JSON", () => {
  it("context que revienta → 500 internal (sin detalles)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.contexto.mockRejectedValue(new Error("connection terminated: secreto-interno"));
    const r = await contexto(new Request(`${BASE}/context?conversationId=cv_1`));
    expect(r.status).toBe(500);
    const cuerpo = await r.json();
    expect(cuerpo).toEqual({ error: { code: "internal", message: "Error interno" } });
    expect(JSON.stringify(cuerpo)).not.toContain("secreto-interno");
  });

  it("cancel: un BookingError del servicio sale con su sobre, no como 500", async () => {
    const token = firmarSeleccion("org_A", { bookingId: "bk_1", conversationId: "cv_1", revision: 100 }, "b".repeat(40));
    fake().responder(schema.conversation, [{ aiEnabled: true, handoffAt: null }]);
    fake().responder(schema.brainOperation, []);
    fake().responder(schema.booking, [{ id: "bk_1", status: "agendada", updatedAt: new Date(100) }]);
    h.cancelarCita.mockRejectedValue(new BookingError("not_found", "Cita no encontrada"));
    const r = await cancelar(
      post("agenda/cancel", { conversationId: "cv_1", selectionToken: token, confirmation: true, idempotencyKey: "k".repeat(64) })
    );
    expect(r.status).toBe(404);
    expect(await r.json()).toMatchObject({ error: { code: "not_found" } });
  });
});

/* ------------------------------------------------------------------ A-8 */

describe("A-8 — /api/brains/llm: tope, JSON y sin stream", () => {
  const ctx = { params: Promise.resolve({ ruta: ["chat", "completions"] }) };
  it("sin application/json → 415", async () => {
    const r = await llm(post("llm/chat/completions", "{}", { "content-type": "text/plain" }), ctx);
    expect(r.status).toBe(415);
  });
  it("más de 25 MB → 413 sin leerlo entero", async () => {
    const r = await llm(post("llm/chat/completions", "{}", { "content-length": String(26 * 1024 * 1024) }), ctx);
    expect(r.status).toBe(413);
  });
  it("cuerpo real que se pasa del tope → 413", async () => {
    const enorme = JSON.stringify({ model: "m", messages: [{ role: "user", content: "x".repeat(25 * 1024 * 1024 + 10) }] });
    const r = await llm(post("llm/chat/completions", enorme), { params: Promise.resolve({ ruta: ["chat", "completions"] }) });
    expect(r.status).toBe(413);
  });
  it("stream: true → 400 stream_no_soportado, sin llamar al proveedor", async () => {
    const espia = vi.spyOn(globalThis, "fetch");
    const r = await llm(post("llm/chat/completions", { model: "m", messages: [], stream: true }), ctx);
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: { code: "stream_no_soportado" } });
    expect(espia).not.toHaveBeenCalled();
  });
  it("JSON válido sin stream sigue al proxy (sin llave propia → 402)", async () => {
    const r = await llm(post("llm/chat/completions", { model: "m", messages: [] }), ctx);
    expect(r.status).toBe(402);
  });
});

/* ------------------------------------------------------------------ A-9 */

describe("A-9 — re-aplicar el Blueprint con el cerebro pausado no falla", () => {
  const ACTOR = { userId: "usr_1", via: "mcp" as const };
  it("mismo cerebro (aunque esté pausado) → sin cambios y sin consultar su estado", async () => {
    fake().responder(schema.organization, [{ actual: "brn_1" }]);
    fake().responder(schema.brainDeployment, [{ status: "pausado" }]);
    expect(await aplicarCerebro(fake().db as never, ACTOR, "org_A", { deployment: "brn_1" })).toBe(false);
    expect(fake().escrituras).toHaveLength(0);
  });
  it("cambiar a uno pausado sí falla", async () => {
    fake().responder(schema.organization, [{ actual: null }]);
    fake().responder(schema.brainDeployment, [{ status: "pausado" }]);
    await expect(aplicarCerebro(fake().db as never, ACTOR, "org_A", { deployment: "brn_2" })).rejects.toMatchObject({
      code: "cerebro_pausado",
    });
  });
});

/* ------------------------------------------------------------------ A-10 */

describe("A-10 — la tarjeta no pinta «Activo» un cerebro que no despacha", () => {
  const fila = (extra: Record<string, unknown>) => ({
    orgStatus: "activa",
    deploymentId: "brn_1",
    name: "Nea",
    status: "activo",
    dispatchUrl: "http://nea:8000/vocero/dispatch",
    healthUrl: null,
    ...extra,
  });
  it("pausado → problem pausado; negocio suspendido → problem suspendida; sin cerebro → null", async () => {
    vi.stubEnv("TENANCY", "multi");
    fake().responder(schema.organization, [fila({ status: "pausado" })]);
    fake().responder(schema.organization, [fila({ status: "pausado" })]);
    expect(await configDespachoPara("org_A")).toMatchObject({ active: false, problem: "pausado", host: "Nea" });
    fake().responder(schema.organization, [fila({ orgStatus: "suspendida" })]);
    fake().responder(schema.organization, [fila({ orgStatus: "suspendida" })]);
    expect(await configDespachoPara("org_A")).toMatchObject({ active: false, problem: "suspendida" });
    fake().responder(schema.organization, [fila({ deploymentId: null, name: null, status: null, dispatchUrl: null })]);
    fake().responder(schema.organization, [fila({ deploymentId: null, name: null, status: null, dispatchUrl: null })]);
    expect(await configDespachoPara("org_A")).toEqual({ active: false, host: null, problem: null });
  });
  it("la tarjeta tiene su vista de «Pausado»", () => {
    const src = readFileSync(join(process.cwd(), "src/components/agent/brain-status-card.tsx"), "utf8");
    expect(src).toMatch(/headline: `Pausado · \$\{d\.host \?\? "tu agente"\}`/);
  });
});

/* ------------------------------------------------------------------ M-4 */

describe("M-4 — idempotencia de cancel serializada y por acción", () => {
  const token = () => firmarSeleccion("org_A", { bookingId: "bk_1", conversationId: "cv_1", revision: 100 }, "b".repeat(40));
  it("la llave usada para OTRA acción → 409 idempotency_key_reused, sin cancelar", async () => {
    const execute = vi.spyOn(fake().db, "execute");
    fake().responder(schema.conversation, [{ aiEnabled: true, handoffAt: null }]);
    fake().responder(schema.brainOperation, [{ response: { ok: true }, action: "book" }]);
    const r = await cancelar(
      post("agenda/cancel", { conversationId: "cv_1", selectionToken: token(), confirmation: true, idempotencyKey: "k".repeat(64) })
    );
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ error: { code: "idempotency_key_reused" } });
    expect(h.cancelarCita).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1); // el candado antes de leer la llave
  });
});

/* ------------------------------------------------------------------ M-5 */

describe("M-5 — con la IA en pausa el cerebro no toca ficha ni citas", () => {
  const PAUSADA = { contactId: "ct_1", aiEnabled: true, handoffAt: new Date(), isTest: false };
  it("ficha → 409 ai_paused", async () => {
    fake().responder(schema.conversation, [PAUSADA]);
    const r = await ficha(new Request(`${BASE}/ficha`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId: "cv_1", ficha: { a: 1 } }) }));
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ error: { code: "ai_paused" } });
  });
  it("reservar → 409 ai_paused sin llegar al calendario", async () => {
    fake().responder(schema.conversation, [{ aiEnabled: false, handoffAt: null }]);
    const r = await reservar(post("agenda/book", { conversationId: "cv_1", startUtc: "2026-12-01T15:00:00Z" }));
    expect(r.status).toBe(409);
    expect(h.crearCita).not.toHaveBeenCalled();
  });
  it("cancelar → 409 ai_paused", async () => {
    fake().responder(schema.conversation, [{ aiEnabled: true, handoffAt: new Date() }]);
    const token = firmarSeleccion("org_A", { bookingId: "bk_1", conversationId: "cv_1", revision: 1 }, "b".repeat(40));
    const r = await cancelar(
      post("agenda/cancel", { conversationId: "cv_1", selectionToken: token, confirmation: true, idempotencyKey: "k".repeat(64) })
    );
    expect(r.status).toBe(409);
    expect(h.cancelarCita).not.toHaveBeenCalled();
  });
  it("/api/bot no cambia: el núcleo solo exige la IA si se lo piden", () => {
    const bot = readFileSync(join(process.cwd(), "src/app/api/bot/ficha/route.ts"), "utf8");
    expect(bot).toMatch(/return escribirFicha\(req, organizationId\);/);
  });
});

/* ------------------------------------------------------------------ M-6 */

describe("M-6 — reprogramar con slot_taken trae alternativas frescas", () => {
  it("rescheduleForConversation refresca la oferta al capturar slot_taken", () => {
    const src = readFileSync(join(process.cwd(), "src/server/agenda/service.ts"), "utf8");
    const cuerpo = src.slice(src.indexOf("export async function rescheduleForConversation"));
    expect(cuerpo.slice(0, 3000)).toMatch(
      /err\.code === "slot_taken"\) \{\s*const fresh = await refreshOffer\(input\.organizationId, input\.conversationId/
    );
  });
});

/* ------------------------------------------------------------------ M-7 */

describe("M-7 — soloOrganizacion sin organización no cae al entorno", () => {
  it("chatJson → not_configured sin llamar a nadie", async () => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "sk-or-plataforma");
    vi.stubEnv("OPENROUTER_MODEL", "modelo/plataforma");
    const espia = vi.spyOn(globalThis, "fetch");
    const r = await chatJson(z.object({ ok: z.boolean() }), [{ role: "user", content: "x" }], { soloOrganizacion: true });
    expect(r).toMatchObject({ ok: false, error: "not_configured" });
    expect(espia).not.toHaveBeenCalled();
    expect(h.credencial).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ M-10 */

describe("M-10 — borrar con el cerebro pausado es «sin confirmar», no «no aplica»", () => {
  it("cerebro asignado pero pausado → sin_confirmar, sin llamar a nadie", async () => {
    vi.stubEnv("TENANCY", "multi");
    const filaPausada = {
      orgStatus: "activa",
      deploymentId: "brn_1",
      name: "Nea",
      status: "pausado",
      dispatchUrl: "http://nea:8000/vocero/dispatch",
      healthUrl: null,
    };
    fake().responder(schema.organization, [filaPausada]);
    fake().responder(schema.organization, [filaPausada]);
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const evento = construirEventoOlvido({
      eventId: "olv_1",
      organization: { id: "org_A", slug: "clinica" },
      conversation: { id: "cv_1", channel: "whatsapp" },
      contact: { id: "ct_1", identity: "x" },
      deletedAt: new Date(),
    });
    expect(await avisarOlvido(evento, { fetchImpl })).toBe("sin_confirmar");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ M-11 */

describe("M-11 — topes y negocio suspendido", () => {
  it("SendError organizacion_suspendida → 403 (no 502)", async () => {
    fake().responder(schema.dispatch, [despacho()]);
    h.responder.mockResolvedValue({ ok: false, code: "organizacion_suspendida", message: "Suspendida" });
    const r = await mensajes(post("messages", CUERPO));
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ error: { code: "organizacion_suspendida" } });
  });
  it("conversationId de más de 128 → 422", async () => {
    const r = await ficha(
      new Request(`${BASE}/ficha`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId: "c".repeat(200), ficha: {} }) })
    );
    expect(r.status).toBe(422);
  });
  it("startUtc y notes con tope en reservar", async () => {
    const r = await reservar(post("agenda/book", { conversationId: "cv_1", startUtc: "x".repeat(100) }));
    expect(r.status).toBe(422);
    const n = await reservar(post("agenda/book", { conversationId: "cv_1", startUtc: "2026-12-01T15:00:00Z", notes: "n".repeat(1001) }));
    expect(n.status).toBe(422);
  });
});

/* ---------------------------------------------------- B-2, B-3, B-5, B-6 */

describe("B-2..B-6 — hardening menor", () => {
  it("B-2: las respuestas con el secreto no se guardan en caché", () => {
    for (const r of ["src/app/api/platform/brains/route.ts", "src/app/api/platform/brains/[id]/rotar/route.ts"]) {
      expect(readFileSync(join(process.cwd(), r), "utf8"), r).toMatch(/"cache-control": "no-store, private"/);
    }
  });

  it("B-3: buscarOrganizacion con dos coincidencias prefiere el id exacto", async () => {
    fake().responder(schema.organization, [
      { id: "org_X", slug: "org_A" },
      { id: "org_A", slug: "clinica" },
    ]);
    expect(await buscarOrganizacion("org_A")).toEqual({ id: "org_A", slug: "clinica" });
  });

  it("B-3: «Probar» tiene tope y los endpoints de cerebros exigen el Origin del panel (M-8)", () => {
    const probar = readFileSync(join(process.cwd(), "src/app/api/platform/brains/[id]/probar/route.ts"), "utf8");
    expect(probar).toMatch(/checkRateLimit\(`brain-probar:\$\{g\.actor\.userId\}`/);
    expect(probar).toMatch(/exigirOrigen: true/);
  });

  it("B-5: la selección vence", () => {
    const t = firmarSeleccion("org_A", { bookingId: "bk", conversationId: "cv", revision: 1 }, "s".repeat(40), 1000);
    expect(leerSeleccion("org_A", t, "s".repeat(40), 1000 + VIDA_SELECCION_MS - 1)).not.toBeNull();
    expect(leerSeleccion("org_A", t, "s".repeat(40), 1000 + VIDA_SELECCION_MS + 1)).toBeNull();
  });

  it("B-6: OPENROUTER_AUDIO_MODEL reemplaza el modelo que oye (con formato válido)", () => {
    expect(modeloQueOyeOpenRouter({})).toBe(MODELO_QUE_OYE_OPENROUTER);
    expect(modeloQueOyeOpenRouter({ OPENROUTER_AUDIO_MODEL: "google/gemini-4-flash" })).toBe("google/gemini-4-flash");
    expect(modeloQueOyeOpenRouter({ OPENROUTER_AUDIO_MODEL: "mal modelo; rm -rf" })).toBe(MODELO_QUE_OYE_OPENROUTER);
  });
});
