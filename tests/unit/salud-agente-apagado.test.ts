import { beforeEach, describe, expect, it, vi } from "vitest";
import { baseGrabadora } from "./fixtures/base-grabadora";

/**
 * 071 (3.8; D8 de la 067, D9 de Aliantis) — Con el Agente apagado, lo marcado
 * con salud se despacha igual (con `agentEnabled: false`) y el cerebro solo
 * puede contestar un mensaje de seguridad por cada entrante de salud.
 */
const h = vi.hoisted(() => ({
  base: null as unknown as ReturnType<typeof import("./fixtures/base-grabadora").baseGrabadora>,
  encolar: vi.fn(async () => ({ notBefore: new Date() })),
}));
vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db")>();
  return { ...original, getDb: () => h.base.db };
});
vi.mock("@/server/dispatch/outbox", () => ({ encolarDespacho: h.encolar }));
vi.mock("@/server/dispatch/worker", () => ({ iniciarWorker: vi.fn(), programarTanda: vi.fn() }));

import { schema } from "@/lib/db";
import { saludSinRespuesta } from "@/server/bot/seguridad";
import { armarEvento } from "@/server/brains/contract";
import { despacharAlCerebro } from "@/server/dispatch/encolar";

beforeEach(() => {
  h.base = baseGrabadora();
  h.encolar.mockClear();
});

const CONV_VIVA = [{ aiEnabled: true, handoffAt: null, isTest: false }];

describe("071 — encolar con el Agente apagado", () => {
  it("un entrante con salud se despacha", async () => {
    h.base.responder(schema.conversation, CONV_VIVA);
    h.base.responder(schema.agentProfile, [{ enabled: false }]);
    await despacharAlCerebro("cv_1", "org_1", "msg_1", { salud: true });
    expect(h.encolar).toHaveBeenCalledTimes(1);
  });

  it("un entrante sin salud no se despacha", async () => {
    h.base.responder(schema.conversation, CONV_VIVA);
    h.base.responder(schema.agentProfile, [{ enabled: false }]);
    await despacharAlCerebro("cv_1", "org_1", "msg_1", { salud: false });
    expect(h.encolar).not.toHaveBeenCalled();
  });

  it("con una persona atendiendo, ni con salud", async () => {
    h.base.responder(schema.conversation, [{ aiEnabled: false, handoffAt: new Date(), isTest: false }]);
    await despacharAlCerebro("cv_1", "org_1", "msg_1", { salud: true });
    expect(h.encolar).not.toHaveBeenCalled();
  });

  it("con el Agente encendido, como siempre", async () => {
    h.base.responder(schema.conversation, CONV_VIVA);
    h.base.responder(schema.agentProfile, [{ enabled: true }]);
    await despacharAlCerebro("cv_1", "org_1", "msg_1");
    expect(h.encolar).toHaveBeenCalledTimes(1);
  });
});

describe("071 — un mensaje de seguridad por cada entrante de salud", () => {
  it("busca un entrante con salud POSTERIOR al último saliente del agente", async () => {
    const ultimo = new Date("2026-11-11T12:00:00Z");
    h.base.responder(schema.message, [{ createdAt: ultimo }]);
    h.base.responder(schema.message, []);
    expect(await saludSinRespuesta("org_1", "cv_1", h.base.db as never)).toBe(false);
    const [, busqueda] = h.base.ops;
    expect(busqueda?.where?.sql).toContain("'salud' = any(");
    expect(busqueda?.where?.sql).toMatch(/"created_at" > \$\d+/);
    expect(busqueda?.where?.params).toEqual(expect.arrayContaining(["org_1", "cv_1", "in"]));
  });

  it("sin salientes del agente, cualquier entrante con salud cuenta", async () => {
    h.base.responder(schema.message, []);
    h.base.responder(schema.message, [{ id: "msg_1" }]);
    expect(await saludSinRespuesta("org_1", "cv_1", h.base.db as never)).toBe(true);
  });
});

describe("071 — el despacho dice que el Agente está apagado", () => {
  const evento = (agentEnabled?: boolean) =>
    armarEvento({
      dispatchId: "dsp_1",
      organization: { id: "org_1", slug: null },
      conversation: {
        id: "cv_1",
        channel: "whatsapp",
        aiEnabled: true,
        windowOpen: true,
        windowExpiresAt: null,
        ...(agentEnabled === undefined ? {} : { agentEnabled }),
      },
      contact: { id: "ct_1", displayName: "Ana", identity: "573001112233" },
      messages: [],
      firstMessageAt: new Date(0),
      lastMessageAt: new Date(0),
    }).conversation;

  it("agentEnabled: false, al final de conversation", () => {
    const c = evento(false);
    expect(c.agentEnabled).toBe(false);
    expect(Object.keys(c).at(-1)).toBe("agentEnabled");
  });

  it("encendido, no lleva la llave: el cuerpo gemelo no cambia", () => {
    expect("agentEnabled" in evento(true)).toBe(false);
    expect("agentEnabled" in evento()).toBe(false);
  });
});
