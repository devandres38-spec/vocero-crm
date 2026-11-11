import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 075 (D4) — Los webhooks llegan sin negocio. El negocio sale de la función
 * de solo ids, y desde ahí todo corre DENTRO de él: el secreto de la firma,
 * el guardado, cada evento del barrido y la verificación de Zernio.
 */
const h = vi.hoisted(() => ({
  vistos: [] as { que: string; negocio: string | null }[],
  pendientes: [] as { id: string; organizationId: string }[],
}));

vi.mock("next/server", () => ({ after: (fn: () => unknown) => void fn() }));
vi.mock("@/server/db-sistema", () => ({
  eventosPendientes: async () => h.pendientes,
  negociosConEventosViejos: async () => [],
  negocioPorCanal: async () => "org_z",
}));

import { conNegocio, negocioActual } from "@/lib/db/contexto";

beforeEach(() => {
  h.vistos = [];
  h.pendientes = [];
});

describe("075 — el barrido procesa cada evento en SU negocio", () => {
  it("dos eventos de dos negocios: cada uno se toma dentro del suyo", async () => {
    vi.resetModules();
    vi.doMock("@/server/webhooks/eventos", async (orig) => ({
      ...(await orig<typeof import("@/server/webhooks/eventos")>()),
      tomarEvento: async (id: string) => {
        h.vistos.push({ que: id, negocio: negocioActual() });
        return null;
      },
    }));
    vi.doMock("@/server/retencion/aplicar", () => ({
      aplicarRetencion: async () => [],
      RETENCION_CADA_MS: Number.MAX_SAFE_INTEGER,
    }));
    const { barrido } = await import("@/server/webhooks/worker");
    h.pendientes = [
      { id: "whe_1", organizationId: "org_a" },
      { id: "whe_2", organizationId: "org_b" },
    ];
    // Disparado desde dentro de otro negocio (un temporizador heredado).
    await conNegocio("org_x", () => barrido(new Date(0)));
    expect(h.vistos).toEqual([
      { que: "whe_1", negocio: "org_a" },
      { que: "whe_2", negocio: "org_b" },
    ]);
  }, 30_000);
});

describe("075 — recibirEvento guarda dentro del negocio verificado", () => {
  it("guardarEvento ve el negocio", async () => {
    vi.resetModules();
    vi.doMock("@/server/webhooks/eventos", () => ({
      guardarEvento: async () => {
        h.vistos.push({ que: "guardar", negocio: negocioActual() });
        return { id: "whe_9", nuevo: false };
      },
    }));
    const { recibirEvento } = await import("@/server/webhooks/recibir");
    const r = await recibirEvento("whatsapp", {}, "{}", "t", { organizationId: "org_a" });
    expect(r.status).toBe(200);
    expect(h.vistos).toEqual([{ que: "guardar", negocio: "org_a" }]);
  });
});

describe("075 — la firma de Meta lee el secreto dentro del negocio", () => {
  it("appSecretDe corre en el negocio de la entrega", async () => {
    vi.resetModules();
    vi.doMock("@/server/whatsapp/app-secret", async (orig) => ({
      ...(await orig<typeof import("@/server/whatsapp/app-secret")>()),
      appSecretDe: async () => {
        h.vistos.push({ que: "secreto", negocio: negocioActual() });
        return null;
      },
    }));
    vi.doMock("@/server/webhooks/organizacion", () => ({
      organizacionesDeLaEntrega: async () => ["org_a"],
    }));
    const { verificarFirmaMeta } = await import("@/server/webhooks/firma");
    await verificarFirmaMeta("whatsapp", {}, "{}", null);
    expect(h.vistos).toEqual([{ que: "secreto", negocio: "org_a" }]);
  });
});

describe("075 — Zernio: el negocio primero, la verificación dentro de él", () => {
  it("findZernioConnection corre dentro del negocio de la cuenta", async () => {
    vi.resetModules();
    vi.doMock("@/server/zernio", async (orig) => ({
      ...(await orig<typeof import("@/server/zernio")>()),
      parseZernioEvent: () => ({ account: { id: "acc_1" } }),
    }));
    vi.doMock("@/server/tiktok/ingest", async (orig) => ({
      ...(await orig<typeof import("@/server/tiktok/ingest")>()),
      zernioPlatform: () => "instagram",
    }));
    vi.doMock("@/server/zernio/conexiones", () => ({
      negocioDeCuentaZernio: async () => "org_z",
      findZernioConnection: async () => {
        h.vistos.push({ que: "conexion", negocio: negocioActual() });
        return null;
      },
      healZernioAccountRef: async () => undefined,
      storedZernioSecrets: async () => [],
    }));
    const { isAuthenticZernioDelivery } = await import("@/server/zernio/dispatch");
    await isAuthenticZernioDelivery("{}", null);
    expect(h.vistos).toEqual([{ que: "conexion", negocio: "org_z" }]);
  });
});
