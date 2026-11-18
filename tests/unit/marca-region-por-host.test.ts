import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REGION_DEFAULTS } from "@/lib/region";

/**
 * 069 (US4, US6) — Marca, apariencia y región sin organización explícita: por
 * subdominio en modo plataforma, con respaldo limpio a Aliantis y a la región
 * de la instancia. En `single`, como en 2.8.0.
 */

const h = vi.hoisted(() => ({
  host: null as string | null,
  porHost: vi.fn(),
  contexto: vi.fn(),
  select: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(h.host ? { host: h.host } : {}),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("@/server/tenant/consultas", () => ({ organizacionPorHost: h.porHost }));
vi.mock("@/lib/auth/session", () => ({ contextoActual: h.contexto }));
vi.mock("@/lib/db", async (original) => ({
  ...(await original<typeof import("@/lib/db")>()),
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: h.select }) }) }),
  }),
}));

import { DEFAULT_BRANDING } from "@/lib/branding";
import { getBrandingContext } from "@/server/branding";
import { getRegionDeOrganizacion, regionDeMetadata } from "@/server/region";
import { organizacionParaMarca } from "@/server/tenant/marca";

const metaClinica = JSON.stringify({
  region: { country: "MX", locale: "es-MX", timezone: "America/Mexico_City" },
  branding: { name: "Clínica Sol", accent: "#10c4a5", currency: "MXN", favicon: null },
});

beforeEach(() => {
  h.host = null;
  h.porHost.mockResolvedValue(null);
  h.contexto.mockResolvedValue({ kind: "anonimo" });
  h.select.mockResolvedValue([]);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("069 — de qué negocio es una pantalla sin sesión", () => {
  it("`single`: ninguno (cada llamador conserva lo de 2.8.0)", async () => {
    h.porHost.mockResolvedValue({ id: "org_A" });
    expect(await organizacionParaMarca()).toBeNull();
    expect(h.porHost).not.toHaveBeenCalled();
  });

  it("`multi`: el subdominio de un negocio activo manda, sin necesitar sesión", async () => {
    vi.stubEnv("TENANCY", "multi");
    h.host = "clinica-sol.aliantis.co";
    h.porHost.mockResolvedValue({ id: "org_A" });
    expect(await organizacionParaMarca()).toBe("org_A");
    expect(h.contexto).not.toHaveBeenCalled();
  });

  it("`multi` en la raíz: la organización de la sesión, si eligió una", async () => {
    vi.stubEnv("TENANCY", "multi");
    h.contexto.mockResolvedValue({ kind: "organizacion", organizationId: "org_B" });
    expect(await organizacionParaMarca()).toBe("org_B");
  });

  it("`multi` sin negocio (raíz, slug inexistente o suspendido): ninguno → Aliantis", async () => {
    vi.stubEnv("TENANCY", "multi");
    h.host = "nadie.aliantis.co";
    expect(await organizacionParaMarca()).toBeNull();
    const ctx = await getBrandingContext();
    expect(ctx).toEqual({ organizationId: null, branding: DEFAULT_BRANDING });
    expect(h.select).not.toHaveBeenCalled(); // nunca «la primera organización»
  });

  it("`multi` con subdominio: la marca de ESE negocio", async () => {
    vi.stubEnv("TENANCY", "multi");
    h.porHost.mockResolvedValue({ id: "org_A" });
    h.select.mockResolvedValue([{ id: "org_A", metadata: metaClinica }]);
    const ctx = await getBrandingContext();
    expect(ctx.organizationId).toBe("org_A");
    expect(ctx.branding).toMatchObject({ name: "Clínica Sol", accent: "#10c4a5", currency: "MXN" });
  });
});

describe("069 — región por organización", () => {
  const instancia = { ...REGION_DEFAULTS };

  it("la guardada gana; la moneda sale de la marca", () => {
    expect(regionDeMetadata(metaClinica, instancia)).toEqual({
      country: "MX",
      locale: "es-MX",
      timezone: "America/Mexico_City",
      currency: "MXN",
    });
  });

  it("sin región guardada hereda la de la instancia", () => {
    expect(regionDeMetadata(null, instancia)).toEqual(instancia);
    expect(regionDeMetadata("{}", instancia)).toEqual(instancia);
    expect(regionDeMetadata("no es json", instancia)).toEqual(instancia);
  });

  it("un valor guardado inválido se ignora campo por campo", () => {
    const meta = JSON.stringify({ region: { country: "Colombia", locale: "es-MX", timezone: "Marte/Olympus" } });
    expect(regionDeMetadata(meta, instancia)).toEqual({ ...instancia, locale: "es-MX" });
  });

  it("`single`: la de la instancia sin tocar la base", async () => {
    expect(await getRegionDeOrganizacion("org_A")).toEqual(instancia);
    expect(h.select).not.toHaveBeenCalled();
  });

  it("`multi`: org MX en una instancia de Colombia usa MX; A↛B por id", async () => {
    vi.stubEnv("TENANCY", "multi");
    h.select.mockResolvedValueOnce([{ metadata: metaClinica }]).mockResolvedValueOnce([{ metadata: null }]);
    expect((await getRegionDeOrganizacion("org_A")).timezone).toBe("America/Mexico_City");
    expect((await getRegionDeOrganizacion("org_B")).timezone).toBe(instancia.timezone);
  });
});
