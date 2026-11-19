import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 072-B (FR-042, T059) — `moduleTools` en `GET /api/brains/context`: solo con
 * herramientas de módulos encendidos, y AUSENTE (no `[]`) si no hay ninguna,
 * para que un negocio sin módulos reciba el cuerpo de 2.12 tal cual.
 */

const h = vi.hoisted(() => ({ modules: [] as string[], pedidos: [] as string[] }));

vi.mock("@/lib/db", async (original) => {
  const real = await original<typeof import("@/lib/db")>();
  const vacio = () => {
    const b: Record<string, unknown> = {
      from: () => b,
      where: () => b,
      orderBy: () => b,
      limit: () => Promise.resolve([]),
      then: (ok: (v: unknown) => unknown) => Promise.resolve([]).then(ok),
    };
    return b;
  };
  return { ...real, getDb: () => ({ select: vacio }) };
});
vi.mock("@/server/bot/nucleo/contexto", () => ({
  contextoDeConversacion: async () => ({ conversation: { id: "cv_1" }, contact: { ficha: {} } }),
}));
vi.mock("@/lib/ai/provider", async (original) => ({
  ...(await original<typeof import("@/lib/ai/provider")>()),
  resolveAiProviderDeOrganizacion: async () => ({ ok: false }),
}));
vi.mock("@/server/modulos/consulta", async (original) => ({
  ...(await original<typeof import("@/server/modulos/consulta")>()),
  modulosDeOrganizacion: async (org: string) => {
    h.pedidos.push(org);
    return { agenda: false, atribucion: false, channels: ["whatsapp"], modules: h.modules };
  },
}));

import { contextoDelCerebro } from "@/server/brains/context";

beforeEach(() => {
  h.modules = [];
  h.pedidos.length = 0;
});

describe("moduleTools en el contexto del cerebro", () => {
  it("sin módulos: el campo NO aparece", async () => {
    const c = await contextoDelCerebro("org_A", "cv_1");
    expect(c).not.toBeNull();
    expect(c).not.toHaveProperty("moduleTools");
  });

  it("con `diagnostico`: sus herramientas, de los módulos de ESTE negocio", async () => {
    h.modules = ["diagnostico"];
    const c = (await contextoDelCerebro("org_A", "cv_1")) as { moduleTools: { name: string }[] };
    expect(c.moduleTools.map((t) => t.name)).toEqual(["diagnostico_eco", "diagnostico_marca"]);
    expect(h.pedidos).toEqual(["org_A"]);
  });
});
