import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeDb } from "./helpers/fake-db";

/**
 * 073-B — Los flujos de la ronda con la base falsa:
 * - D4: el despacho no sale con el contacto dado de baja ni por encima del
 *   tope anti-flood (y avisa); debajo del tope, sale.
 * - D2: el `summary` del handoff queda como nota; `opt_out` registra la baja.
 * - D6: `registrarBaja` confirma UNA vez, pausa con `opt_out` y deja nota;
 *   marcada por una persona no le escribe al cliente.
 */

const h = vi.hoisted(() => ({
  fake: null as FakeDb | null,
  encolar: vi.fn(async () => ({ id: "dsp_1", notBefore: new Date() })),
  conteo: { conversacionHora: 0, conversacionDia: 0, organizacionDia: 0 },
  avisarTope: vi.fn(async () => {}),
  notaHandoff: vi.fn(async () => {}),
  registrarBaja: vi.fn(async () => true),
  sendText: vi.fn(async () => ({ messageId: "msg_conf" })),
  crearNota: vi.fn(async () => null),
  publish: vi.fn(),
}));

vi.mock("@/lib/db", async (original) => {
  const { crearFakeDb } = await import("./helpers/fake-db");
  h.fake = crearFakeDb();
  return { ...(await original<typeof import("@/lib/db")>()), getDb: () => h.fake!.db };
});
vi.mock("@/server/dispatch/outbox", () => ({ encolarDespacho: h.encolar }));
vi.mock("@/server/dispatch/worker", () => ({ iniciarWorker: vi.fn(), programarTanda: vi.fn() }));
vi.mock("@/server/platform/estado", () => ({ organizacionSuspendida: vi.fn(async () => false) }));
vi.mock("@/server/dispatch/antiflood", async (original) => ({
  ...(await original<typeof import("@/server/dispatch/antiflood")>()),
  contarDespachos: vi.fn(async () => h.conteo),
}));
vi.mock("@/server/incidentes", () => ({
  registrarIncidente: vi.fn(async () => true),
  cuboHora: () => "2026-11-19T22",
  avisarTopeAntiFlood: h.avisarTope,
  notaDeHandoff: h.notaHandoff,
}));
vi.mock("@/server/events/bus", () => ({ publish: h.publish }));
vi.mock("@/server/inbox/send", () => ({ sendText: h.sendText }));
vi.mock("@/server/notas", () => ({ crearNotaDelSistema: h.crearNota }));

import { schema } from "@/lib/db";
import { despacharAlCerebro } from "@/server/dispatch/encolar";
import { pasarAHumanoPorElCerebro } from "@/server/bot/nucleo/acciones";

const CONV = { aiEnabled: true, handoffAt: null, isTest: false, optOutAt: null };

beforeEach(() => {
  vi.unstubAllEnvs();
  h.fake!.reiniciar();
  h.conteo = { conversacionHora: 0, conversacionDia: 0, organizacionDia: 0 };
  for (const f of [h.encolar, h.avisarTope, h.notaHandoff, h.registrarBaja, h.sendText, h.crearNota, h.publish]) {
    f.mockClear();
  }
});

function listo(conv: Record<string, unknown> = CONV) {
  h.fake!.responder(schema.conversation, [conv]);
  h.fake!.responder(schema.agentProfile, [{ enabled: true }]);
}

describe("despacharAlCerebro (073-B)", () => {
  it("debajo del tope: se encola", async () => {
    listo();
    await despacharAlCerebro("cv_1", "org_1", "msg_1");
    expect(h.encolar).toHaveBeenCalledTimes(1);
    expect(h.avisarTope).not.toHaveBeenCalled();
  });

  it("contacto dado de baja (Ley 1581): no se encola aunque la IA esté encendida", async () => {
    listo({ ...CONV, optOutAt: new Date() });
    await despacharAlCerebro("cv_1", "org_1", "msg_1");
    expect(h.encolar).not.toHaveBeenCalled();
  });

  it("tope por conversación/hora alcanzado: no se encola y avisa (abuso + nota)", async () => {
    listo();
    h.conteo = { conversacionHora: 25, conversacionDia: 25, organizacionDia: 25 };
    await despacharAlCerebro("cv_1", "org_1", "msg_1");
    expect(h.encolar).not.toHaveBeenCalled();
    expect(h.avisarTope).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_1", conversationId: "cv_1", alcance: "conversacion_hora", tope: 25 })
    );
  });

  it("los topes los fija la plataforma (metadata.bot.limits)", async () => {
    listo();
    h.fake!.responder(schema.organization, [{ metadata: JSON.stringify({ bot: { limits: { perOrganizationDay: 50 } } }) }]);
    h.conteo = { conversacionHora: 1, conversacionDia: 1, organizacionDia: 50 };
    await despacharAlCerebro("cv_1", "org_1", "msg_1");
    expect(h.encolar).not.toHaveBeenCalled();
    expect(h.avisarTope).toHaveBeenCalledWith(expect.objectContaining({ alcance: "organizacion_dia", tope: 50 }));
  });

  it("el conteo sale de la tabla `dispatch`, no de memoria", () => {
    const fuente = readFileSync(join(process.cwd(), "src", "server", "dispatch", "antiflood.ts"), "utf8");
    expect(fuente).toMatch(/\.from\(d\)/);
    expect(fuente).toMatch(/const d = schema\.dispatch/);
  });
});

function peticion(cuerpo: unknown): Request {
  return new Request("https://crm.test/api/brains/handoff", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
}

describe("handoff (073-B)", () => {
  it("con `summary`: nota interna (recortada a 500)", async () => {
    h.fake!.responder(schema.conversation, [{ id: "cv_1", handoffAt: null }]);
    const res = await pasarAHumanoPorElCerebro(
      peticion({ conversationId: "cv_1", reason: "lead_request", summary: "Quiere precio de limpieza. " + "x".repeat(900) }),
      "org_1"
    );
    expect(res.status).toBe(200);
    expect(h.notaHandoff).toHaveBeenCalledTimes(1);
    const [arg] = h.notaHandoff.mock.calls[0] as unknown as [{ resumen: string }];
    expect(arg.resumen.length).toBe(500);
  });

  it("sin `summary`: sin nota (el cuerpo de siempre sigue valiendo)", async () => {
    h.fake!.responder(schema.conversation, [{ id: "cv_1", handoffAt: null }]);
    expect((await pasarAHumanoPorElCerebro(peticion({ conversationId: "cv_1" }), "org_1")).status).toBe(200);
    expect(h.notaHandoff).not.toHaveBeenCalled();
  });

  it("motivo `opt_out`: el CRM registra la baja (origen agente)", async () => {
    h.fake!.responder(schema.conversation, [{ id: "cv_1", handoffAt: null }]);
    // registrarBaja hace sus propias consultas: conversación y contacto.
    h.fake!.responder(schema.conversation, [{ contactId: "ct_1", isTest: false }]);
    await pasarAHumanoPorElCerebro(peticion({ conversationId: "cv_1", reason: "opt_out" }), "org_1");
    const updates = h.fake!.de(schema.contact, "update");
    expect(updates[0]?.valores).toMatchObject({ optOutSource: "agente" });
  });
});

describe("registrarBaja", () => {
  async function registrar(origen: "detector" | "agente" | "operador", nueva = true) {
    const { registrarBaja } = await import("@/server/bajas");
    h.fake!.responder(schema.conversation, [{ contactId: "ct_1", isTest: false }]);
    h.fake!.responder("update:", nueva ? [{ id: "ct_1" }] : []);
    return registrarBaja({ organizationId: "org_1", conversationId: "cv_1", origen });
  }

  it("primera vez: confirma con el texto fijo, pausa con opt_out y deja nota", async () => {
    expect(await registrar("detector")).toBe(true);
    expect(h.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "cv_1", aiGenerated: true, text: expect.stringMatching(/no le enviaremos/) })
    );
    const pausa = h.fake!.de(schema.conversation, "update")[0]!.valores;
    expect(pausa.aiEnabled).toBe(false);
    expect(h.crearNota).toHaveBeenCalledWith("org_1", "cv_1", expect.stringMatching(/Ley 1581/));
  });

  it("repetida: ni otra confirmación ni otra nota (idempotente)", async () => {
    expect(await registrar("detector", false)).toBe(false);
    expect(h.sendText).not.toHaveBeenCalled();
    expect(h.crearNota).not.toHaveBeenCalled();
  });

  it("marcada por una persona: no le escribe al cliente", async () => {
    expect(await registrar("operador")).toBe(true);
    expect(h.sendText).not.toHaveBeenCalled();
    expect(h.crearNota).toHaveBeenCalledWith("org_1", "cv_1", expect.stringMatching(/Una persona del equipo/));
  });

  it("si la confirmación no sale (ventana cerrada), la baja vale igual", async () => {
    h.sendText.mockRejectedValueOnce(new Error("window_closed"));
    const espia = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await registrar("agente")).toBe(true);
    expect(h.crearNota).toHaveBeenCalled();
    espia.mockRestore();
  });

  it("vive fuera de las carpetas vigiladas por el guardarraíl de notas", () => {
    const fuente = readFileSync(join(process.cwd(), "src", "server", "bajas.ts"), "utf8");
    expect(fuente).not.toMatch(/conversationNote|listarNotas/);
  });
});

describe("humanGap (D1)", () => {
  it("lee el tramo de la pausa a la reanudación, en orden", async () => {
    const { tramoHumano } = await import("@/server/brains/humano");
    h.fake!.responder(schema.message, []); // la IA aún no contestó tras reanudar
    h.fake!.responder(schema.message, [
      { direction: "out", type: "text", text: "Ya le agendé con la Dra. Ana", createdAt: new Date("2026-11-19T15:10:00Z") },
      { direction: "in", type: "text", text: "Quiero hablar con alguien", createdAt: new Date("2026-11-19T15:00:00Z") },
    ]);
    const gap = await tramoHumano("org_1", "cv_1", new Date("2026-11-19T14:59:00Z"), new Date("2026-11-19T15:30:00Z"));
    expect(gap).toEqual({
      since: "2026-11-19T14:59:00.000Z",
      until: "2026-11-19T15:30:00.000Z",
      messages: [
        { at: "2026-11-19T15:00:00.000Z", author: "lead", type: "text", text: "Quiero hablar con alguien" },
        { at: "2026-11-19T15:10:00.000Z", author: "humano", type: "text", text: "Ya le agendé con la Dra. Ana" },
      ],
    });
  });

  it("UNA vez: si la IA ya contestó después de reanudar, no viaja", async () => {
    const { tramoHumano } = await import("@/server/brains/humano");
    h.fake!.responder(schema.message, [{ id: "msg_ia" }]);
    expect(await tramoHumano("org_1", "cv_1", new Date("2026-11-19T14:00:00Z"), new Date("2026-11-19T15:00:00Z"))).toBeNull();
  });

  it("sin tramo anotado: nada", async () => {
    const { tramoHumano } = await import("@/server/brains/humano");
    expect(await tramoHumano("org_1", "cv_1", null, null)).toBeNull();
  });

  it("reanudar la IA anota el tramo; pausarla anota desde cuándo", async () => {
    const { updateConversation } = await import("@/server/inbox/queries");
    await updateConversation("org_1", "cv_1", { reactivate: true });
    const reanudar = h.fake!.de(schema.conversation, "update")[0]!.valores;
    expect(reanudar).toMatchObject({ aiEnabled: true, handoffAt: null, aiPausedAt: null });
    expect(reanudar.humanGapFrom).toBeDefined();
    expect(reanudar.humanGapTo).toBeDefined();

    h.fake!.reiniciar();
    await updateConversation("org_1", "cv_1", { aiEnabled: false });
    const pausar = h.fake!.de(schema.conversation, "update")[0]!.valores;
    expect(pausar.aiPausedAt).toBeDefined();
    expect(pausar.humanGapFrom).toBeUndefined();
  });
});

describe("pausa al responder desde la Bandeja (D1, decisión #1)", () => {
  it("el helper solo pausa si no había handoff y publica el cambio", async () => {
    const { pausarPorRespuestaHumana } = await import("@/server/inbox/pausa");
    h.fake!.responder("update:", [{ id: "cv_1" }]);
    expect(await pausarPorRespuestaHumana("org_1", "cv_1")).toBe(true);
    expect(h.fake!.de(schema.conversation, "update")[0]!.valores).toMatchObject({
      aiEnabled: false,
      handoffReason: "manual_reply",
    });
    expect(h.publish).toHaveBeenCalledWith("org_1", expect.objectContaining({ type: "conversation.updated" }));

    h.publish.mockClear();
    expect(await pausarPorRespuestaHumana("org_1", "cv_1")).toBe(false); // ya en handoff
    expect(h.publish).not.toHaveBeenCalled();
  });

  it("send.ts y el eco del teléfono usan el MISMO helper", () => {
    const send = readFileSync(join(process.cwd(), "src", "server", "inbox", "send.ts"), "utf8");
    const ingest = readFileSync(join(process.cwd(), "src", "server", "inbox", "ingest.ts"), "utf8");
    const plantillas = readFileSync(join(process.cwd(), "src", "server", "whatsapp", "templates.ts"), "utf8");
    for (const f of [send, ingest, plantillas]) expect(f).toContain("pausarPorRespuestaHumana(");
    expect(ingest).not.toMatch(/handoffReason:\s*"manual_reply"/);
    // Solo lo que escribe una persona pausa: la respuesta de la IA no.
    expect(send).toMatch(/if \(!input\.aiGenerated\) await pausaDelOperador/);
  });
});

describe("opt-out bloquea todo lo automático (Ley 1581)", () => {
  it("plantillas, respuestas y seguimientos del cerebro miran `optOutAt`", () => {
    const leer = (...p: string[]) => readFileSync(join(process.cwd(), "src", ...p), "utf8");
    const plantillas = leer("server", "whatsapp", "templates.ts");
    expect(plantillas).toMatch(/if \(row\.contact\.optOutAt\)/);
    expect(plantillas).toMatch(/"opt_out"/);
    // Los seguimientos del cerebro salen por `/messages`: el mismo gate.
    expect(leer("server", "bot", "nucleo", "mensajes.ts")).toMatch(/conv\.optOutAt/);
    expect(leer("server", "dispatch", "encolar.ts")).toMatch(/if \(conv\.optOutAt\) return/);
    // El operador sí puede contestar: `sendText` no lo bloquea.
    expect(leer("server", "inbox", "send.ts")).not.toMatch(/optOutAt/);
  });

  it("templateErrorStatus: opt_out → 409", async () => {
    const { TemplateError, templateErrorStatus } = await import("@/server/whatsapp/templates");
    expect(templateErrorStatus(new TemplateError("opt_out", "x"))).toBe(409);
  });
});
