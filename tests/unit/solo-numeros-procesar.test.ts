import { beforeEach, describe, expect, it, vi } from "vitest";
import { baseGrabadora } from "./fixtures/base-grabadora";

/**
 * 079 (T5) — `procesar` (por `tanda`) relee la lista al ENTREGAR: un número
 * sacado de la lista durante la ventana de agrupado se descarta y no llega al
 * cerebro.
 */
const h = vi.hoisted(() => ({
  base: null as unknown as ReturnType<typeof import("./fixtures/base-grabadora").baseGrabadora>,
  cola: [] as { id: string; organizationId: string; conversationId: string }[],
  descartes: [] as string[],
  entregas: 0,
  identidad: "573001112233",
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db")>();
  return { ...original, getDb: () => h.base.db };
});
vi.mock("@/server/db-sistema", () => ({
  despachosVencidos: async (_a: Date, _l: number, excluir: readonly string[]) => {
    const f = h.cola.find((x) => !excluir.includes(x.organizationId));
    return f ? [{ id: f.id, organizationId: f.organizationId }] : [];
  },
  negociosConOlvidos: async () => [],
  negociosConAvisos: async () => [],
}));
vi.mock("@/server/dispatch/outbox", async (orig) => ({
  ...(await orig<typeof import("@/server/dispatch/outbox")>()),
  tomarPendientes: async () => h.cola.splice(0, 1),
  descartarDespacho: async (_f: unknown, motivo: string) => {
    h.descartes.push(motivo);
  },
  renovarLease: async () => true,
  marcarEntregado: async () => true,
  mensajesAnotados: async () => [],
}));
vi.mock("@/server/brains/config", () => ({
  leerConfigDespacho: () => ({ active: true, url: "http://cerebro", secret: "s" }),
}));
vi.mock("@/server/brains/deliver", async (orig) => ({
  ...(await orig<typeof import("@/server/brains/deliver")>()),
  construirEvento: async () => ({
    dispatchId: "dsp_1",
    organization: { id: "org_1", slug: null },
    conversation: {
      id: "cv_1",
      channel: "whatsapp",
      aiEnabled: true,
      windowOpen: true,
      windowExpiresAt: null,
    },
    contact: { id: "ct_1", displayName: "Ana", identity: h.identidad },
    messages: [{ id: "msg_1", at: "2026-11-12T00:00:00.000Z", type: "text", text: "hola", mediaId: null }],
    firstMessageAt: "2026-11-12T00:00:00.000Z",
    lastMessageAt: "2026-11-12T00:00:00.000Z",
  }),
  entregar: async () => {
    h.entregas++;
    return { ok: true };
  },
  rafagaDe: async () => [],
}));
vi.mock("@/server/avisos/avisos", () => ({
  enviarAvisosPendientes: async () => undefined,
  registrarTraspaso: async () => undefined,
}));
vi.mock("@/server/dispatch/olvidos", () => ({ reintentarOlvidos: async () => undefined }));

import { schema } from "@/lib/db";
import { tanda } from "@/server/dispatch/worker";

beforeEach(() => {
  h.base = baseGrabadora();
  h.cola = [{ id: "dsp_1", organizationId: "org_1", conversationId: "cv_1" }];
  h.descartes = [];
  h.entregas = 0;
  h.base.responder(schema.conversation, [{ aiEnabled: true, handoffAt: null, isTest: false }]);
});

describe("079 — procesar relee la lista al entregar", () => {
  it("sacado de la lista durante la ventana: se descarta con el motivo y no llega", async () => {
    h.base.responder(schema.agentProfile, [{ activo: true, numeros: ["573009998877"] }]);
    await tanda();
    expect(h.descartes).toEqual(["fuera de la lista de números"]);
    expect(h.entregas).toBe(0);
  });

  it("sigue en la lista: se entrega", async () => {
    h.base.responder(schema.agentProfile, [{ activo: true, numeros: ["573001112233"] }]);
    await tanda();
    expect(h.descartes).toEqual([]);
    expect(h.entregas).toBe(1);
  });
});
