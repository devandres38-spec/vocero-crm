import { beforeEach, describe, expect, it, vi } from "vitest";
import { moverEtapaPorEvento } from "@/server/bot/stage";

/**
 * 078 (T3, D18 de Aliantis) — El cerebro mueve la etapa por un evento. La
 * etapa sale del mapeo del negocio; nunca hacia atrás, nunca a ganada o
 * perdida, nunca con una persona atendiendo ni en el Laboratorio.
 */
const dbState = vi.hoisted(() => ({ queue: [] as unknown[][] }));
const movimientos = vi.hoisted(() => ({ llamadas: [] as { leadId: string; toStageId: string }[] }));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "limit", "orderBy"]) {
    builder[m] = () => builder;
  }
  (builder as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    resolve(dbState.queue.shift() ?? []);
  return { ...actual, getDb: () => builder };
});

vi.mock("@/server/leads/stage-history", () => ({
  moveLeadToStage: async (input: { leadId: string; toStageId: string }) => {
    movimientos.llamadas.push(input);
    return { ok: true, changed: true, lead: { id: input.leadId, contactId: "ct_1", stageId: input.toStageId } };
  },
}));

const PIPELINE = [
  { id: "st_nuevo", name: "Nuevo", position: 0, kind: "open", eventoBot: null },
  { id: "st_conv", name: "En conversación", position: 1, kind: "open", eventoBot: "primera_respuesta" },
  { id: "st_int", name: "Interesado", position: 2, kind: "open", eventoBot: "servicio_consultado" },
  { id: "st_cita", name: "Quiere cita", position: 3, kind: "open", eventoBot: "pidio_cita" },
  { id: "st_cliente", name: "Cliente", position: 4, kind: "won", eventoBot: null },
  { id: "st_perdido", name: "Perdido", position: 5, kind: "lost", eventoBot: null },
];

const CONV = { id: "cv_1", contactId: "ct_1", aiEnabled: true, handoffAt: null, isTest: false };

/** conversación, perfil, lead, etapas: el orden en que se consultan. */
function base(
  opts: {
    conversacion?: object;
    tools?: string[] | null;
    leadStage?: string | null;
    pipeline?: object[];
  } = {}
) {
  dbState.queue.push(
    [{ ...CONV, ...(opts.conversacion ?? {}) }],
    [{ tools: opts.tools ?? null }],
    opts.leadStage === null ? [] : [{ id: "ld_1", stageId: opts.leadStage ?? "st_nuevo" }],
    opts.pipeline ?? PIPELINE
  );
}

const mover = (evento: "primera_respuesta" | "servicio_consultado" | "pidio_cita" | "cita_agendada") =>
  moverEtapaPorEvento({ organizationId: "org_1", conversationId: "cv_1", evento });

beforeEach(() => {
  dbState.queue = [];
  movimientos.llamadas = [];
});

describe("078 — la etapa por evento", () => {
  it("mueve a la etapa mapeada, hacia adelante", async () => {
    base();
    const r = await mover("servicio_consultado");
    expect(r).toMatchObject({ ok: true, changed: true, lead: { stageName: "Interesado" } });
    expect(movimientos.llamadas).toEqual([expect.objectContaining({ toStageId: "st_int" })]);
  });

  it("puede saltar etapas hacia adelante", async () => {
    base({ leadStage: "st_nuevo" });
    expect(await mover("pidio_cita")).toMatchObject({ changed: true, lead: { stageName: "Quiere cita" } });
  });

  it("nunca hacia atrás: ya_esta, sin moverlo", async () => {
    base({ leadStage: "st_cita" });
    expect(await mover("primera_respuesta")).toEqual({
      ok: true,
      changed: false,
      motivo: "ya_esta",
      conversationId: "cv_1",
    });
    expect(movimientos.llamadas).toEqual([]);
  });

  it("en la misma etapa: ya_esta", async () => {
    base({ leadStage: "st_int" });
    expect(await mover("servicio_consultado")).toMatchObject({ changed: false, motivo: "ya_esta" });
    expect(movimientos.llamadas).toEqual([]);
  });

  it("nunca reabre un lead ganado o perdido", async () => {
    for (const cerrado of ["st_cliente", "st_perdido"]) {
      base({ leadStage: cerrado });
      expect(await mover("primera_respuesta")).toMatchObject({ changed: false, motivo: "ya_esta" });
    }
    expect(movimientos.llamadas).toEqual([]);
  });

  it("un evento sin etapa en el negocio: sin_etapa", async () => {
    base();
    expect(await mover("cita_agendada")).toMatchObject({ ok: true, changed: false, motivo: "sin_etapa" });
  });

  it("un mapeo en una etapa que no es abierta se ignora (la base ya lo impide)", async () => {
    base({
      pipeline: PIPELINE.map((s) => (s.id === "st_cliente" ? { ...s, eventoBot: "cita_agendada" } : s)),
    });
    expect(await mover("cita_agendada")).toMatchObject({ changed: false, motivo: "sin_etapa" });
    expect(movimientos.llamadas).toEqual([]);
  });

  it("Laboratorio: prueba, sin leer nada más ni mover", async () => {
    dbState.queue.push([{ ...CONV, isTest: true }]);
    expect(await mover("primera_respuesta")).toEqual({
      ok: true,
      changed: false,
      motivo: "prueba",
      conversationId: "cv_1",
    });
    expect(movimientos.llamadas).toEqual([]);
  });

  it("con una persona atendiendo: 409 ai_paused", async () => {
    base({ conversacion: { handoffAt: new Date() } });
    expect(await mover("primera_respuesta")).toMatchObject({ ok: false, status: 409, code: "ai_paused" });
    base({ conversacion: { aiEnabled: false } });
    expect(await mover("primera_respuesta")).toMatchObject({ code: "ai_paused" });
    expect(movimientos.llamadas).toEqual([]);
  });

  it("con la herramienta etapa apagada: 409", async () => {
    base({ tools: ["ficha"] });
    expect(await mover("primera_respuesta")).toMatchObject({ code: "herramienta_apagada" });
  });

  it("sin lead: 404 sin_lead; sin conversación: 404 not_found", async () => {
    base({ leadStage: null });
    expect(await mover("primera_respuesta")).toMatchObject({ status: 404, code: "sin_lead" });
    dbState.queue.push([]);
    expect(await mover("primera_respuesta")).toMatchObject({ status: 404, code: "not_found" });
  });
});
