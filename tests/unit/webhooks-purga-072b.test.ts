import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 072-B (auditoría M-2) — Las purgas del barrido de webhooks: si la de
 * eventos falla, el barrido no se cae y la de llamadas a herramientas
 * (`brain_tool_call`) corre igual; y al revés.
 */

const h = vi.hoisted(() => ({
  purgar: vi.fn(),
  purgarLlamadas: vi.fn(),
}));

vi.mock("@/server/webhooks/eventos", () => ({
  tomarPendientes: async () => [],
  tomarEvento: async () => null,
  marcarProcesado: async () => {},
  reintentarOAgotar: async () => {},
  purgar: h.purgar,
}));
vi.mock("@/server/webhooks/procesar", () => ({ procesarFuente: async () => {} }));
vi.mock("@/server/brains/llamadas-retencion", () => ({ purgarLlamadasViejas: h.purgarLlamadas }));

import { barrido } from "@/server/webhooks/worker";

// Cada prueba usa un «ahora» muy posterior a la anterior para que toque purgar.
let reloj = Date.parse("2030-01-01T00:00:00Z");
const despues = () => new Date((reloj += 365 * 24 * 60 * 60 * 1000));

beforeEach(() => {
  h.purgar.mockReset();
  h.purgarLlamadas.mockReset();
});

describe("barrido: purgas aisladas", () => {
  it("si la purga de eventos falla, no lanza y la de llamadas corre igual", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    h.purgar.mockRejectedValue(new Error("base caída"));
    h.purgarLlamadas.mockResolvedValue(3);
    await expect(barrido(despues())).resolves.toBe(0);
    expect(h.purgarLlamadas).toHaveBeenCalledTimes(1);
    expect(err.mock.calls.some((c) => String(c[0]).includes("purga de eventos"))).toBe(true);
    err.mockRestore();
  });

  it("si falla la de llamadas, la de eventos ya corrió y el barrido sigue", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    h.purgar.mockResolvedValue(2);
    h.purgarLlamadas.mockRejectedValue(new Error("lento"));
    await expect(barrido(despues())).resolves.toBe(0);
    expect(h.purgar).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });
});
