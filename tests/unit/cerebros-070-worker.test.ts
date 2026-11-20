import { beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/lib/db";
import type { FakeDb } from "./helpers/fake-db";

/**
 * 070 — F5: el worker entrega cada despacho al cerebro de SU organización,
 * resuelto al entregar; anota qué despliegue lo recibió y, en `multi`, le pone
 * `expiresAt` al evento.
 */

const h = vi.hoisted(() => ({
  fake: null as FakeDb | null,
  pendientes: [] as unknown[][],
  destinoDe: vi.fn(),
  construirEvento: vi.fn(),
  entregar: vi.fn(),
  descartar: vi.fn(),
  anotar: vi.fn(),
  caducar: vi.fn(),
  avisar: vi.fn(),
  verificar: vi.fn(),
}));

vi.mock("@/lib/db", async (original) => {
  const { crearFakeDb } = await import("./helpers/fake-db");
  h.fake = crearFakeDb();
  return { ...(await original<typeof import("@/lib/db")>()), getDb: () => h.fake!.db };
});
vi.mock("@/server/brains/destino", () => ({ destinoDe: h.destinoDe }));
vi.mock("@/server/brains/red", () => ({ verificarDestino: h.verificar }));
vi.mock("@/server/brains/deliver", () => ({
  construirEvento: h.construirEvento,
  entregar: h.entregar,
  rafagaDe: vi.fn(async () => []),
  sinDespachar: vi.fn(() => []),
}));
vi.mock("@/server/dispatch/outbox", () => ({
  tomarPendientes: vi.fn(async () => h.pendientes.shift() ?? []),
  renovarLease: vi.fn(async () => true),
  marcarEntregado: vi.fn(async () => true),
  mensajesAnotados: vi.fn(async () => []),
  descartarDespacho: h.descartar,
  anotarDespliegue: h.anotar,
  encolarDespacho: vi.fn(),
  reintentarOCaducar: vi.fn(async () => false),
  caducarAHumano: h.caducar,
}));
vi.mock("@/server/incidentes", () => ({ avisarCaidaDelCerebro: h.avisar }));

import { tanda, VIDA_DESPACHO_MS } from "@/server/dispatch/worker";

const fake = () => h.fake!;
const CREADO = new Date("2026-11-18T10:00:00Z");
const FILA = {
  id: "dsp_1",
  organizationId: "org_A",
  conversationId: "cv_1",
  createdAt: CREADO,
  brainDeploymentId: null,
  messageIds: ["msg_1"],
  attempts: 1,
};
const DESTINO = {
  url: "http://nea:8000/vocero/dispatch",
  secret: "s".repeat(43),
  host: "Nea",
  deploymentId: "brn_1",
  healthUrl: "http://nea:8000/health",
};

beforeEach(() => {
  fake().reiniciar();
  h.pendientes.length = 0;
  for (const f of [h.destinoDe, h.construirEvento, h.entregar, h.descartar, h.anotar, h.caducar, h.avisar, h.verificar]) {
    f.mockReset();
  }
  h.anotar.mockResolvedValue(true);
  h.caducar.mockResolvedValue(true);
  h.verificar.mockResolvedValue(null);
  vi.unstubAllEnvs();
  h.construirEvento.mockResolvedValue({ dispatchId: "dsp_1", messages: [{ id: "msg_1" }] });
  h.entregar.mockResolvedValue({ ok: true });
});

describe("worker en modo plataforma", () => {
  it("entrega al destino de la organización, anota el despliegue y pone expiresAt", async () => {
    vi.stubEnv("TENANCY", "multi");
    h.pendientes.push([FILA]);
    h.destinoDe.mockResolvedValue(DESTINO);
    fake().responder(schema.conversation, [{ aiEnabled: true, handoffAt: null, isTest: false }]);

    vi.useFakeTimers({ now: new Date("2026-11-18T10:00:03Z"), toFake: ["Date"] });
    try {
      expect(await tanda(new Date("2026-11-18T10:00:03Z"))).toBe(1);
    } finally {
      vi.useRealTimers();
    }
    expect(h.destinoDe).toHaveBeenCalledWith("org_A");
    expect(h.construirEvento).toHaveBeenCalledWith(FILA, { expiresAt: new Date(CREADO.getTime() + VIDA_DESPACHO_MS) });
    // A-12: con el lease (la fila), no con un UPDATE suelto por id.
    expect(h.anotar).toHaveBeenCalledWith(FILA, "brn_1");
    expect(h.verificar).toHaveBeenCalledWith(DESTINO.url);
    expect(h.entregar.mock.calls[0]![1]).toBe(DESTINO);
  });

  it("M-10: un despacho ya vencido no se le manda a Nea (073-A: incidente + nota, la IA sigue)", async () => {
    vi.stubEnv("TENANCY", "multi");
    h.pendientes.push([{ ...FILA, createdAt: new Date(Date.now() - VIDA_DESPACHO_MS - 1000) }]);
    h.destinoDe.mockResolvedValue(DESTINO);
    h.caducar.mockResolvedValue(true);
    await tanda();
    expect(h.caducar).toHaveBeenCalledWith(expect.objectContaining({ id: "dsp_1" }), "el despacho venció antes de entregarse");
    expect(h.avisar).toHaveBeenCalledWith({
      organizationId: "org_A",
      conversationId: "cv_1",
      detalle: "el despacho venció antes de entregarse",
    });
    expect(h.entregar).not.toHaveBeenCalled();
  });

  it("A-2: un destino que resuelve a una IP reservada no recibe el despacho", async () => {
    vi.stubEnv("TENANCY", "multi");
    h.pendientes.push([{ ...FILA, createdAt: new Date() }]);
    h.destinoDe.mockResolvedValue(DESTINO);
    h.verificar.mockResolvedValue("ip_reservada");
    fake().responder(schema.conversation, [{ aiEnabled: true, handoffAt: null, isTest: false }]);
    await tanda();
    expect(h.entregar).not.toHaveBeenCalled();
    expect(h.caducar).toHaveBeenCalledWith(expect.anything(), "destino del cerebro no permitido (ip_reservada)");
  });

  it("sin cerebro (no asignado, pausado o negocio suspendido): se descarta y queda en la bandeja", async () => {
    vi.stubEnv("TENANCY", "multi");
    h.pendientes.push([FILA]);
    h.destinoDe.mockResolvedValue(null);
    await tanda();
    expect(h.descartar).toHaveBeenCalledWith(FILA, "el despacho ya no está configurado");
    expect(h.entregar).not.toHaveBeenCalled();
  });

  it("en `single` no se anota despliegue ni expiresAt (el cuerpo gemelo no cambia)", async () => {
    vi.stubEnv("TENANCY", "");
    h.pendientes.push([FILA]);
    h.destinoDe.mockResolvedValue({ ...DESTINO, deploymentId: null });
    fake().responder(schema.conversation, [{ aiEnabled: true, handoffAt: null, isTest: false }]);
    await tanda();
    expect(h.construirEvento).toHaveBeenCalledWith(FILA, {});
    expect(fake().de(schema.dispatch, "update")).toHaveLength(0);
  });
});
