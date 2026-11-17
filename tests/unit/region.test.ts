import { afterEach, describe, expect, it } from "vitest";
import {
  formatDate,
  formatNumber,
  getRegion,
  REGION_DEFAULTS,
  resetRegionCache,
  resolveRegion,
} from "@/lib/region";
import { checkRegion } from "@/server/doctor/checks";

describe("068 — región de la instancia", () => {
  afterEach(() => {
    resetRegionCache();
    delete process.env.REGION_CURRENCY;
  });

  it("sin variables, la región es Colombia", () => {
    expect(resolveRegion({})).toEqual({
      region: { country: "CO", locale: "es-CO", currency: "COP", timezone: "America/Bogota" },
      invalidas: [],
    });
    expect(REGION_DEFAULTS.timezone).toBe("America/Bogota");
  });

  it("cada variable cambia su campo; país y moneda en mayúsculas", () => {
    const { region, invalidas } = resolveRegion({
      REGION_COUNTRY: "mx",
      REGION_LOCALE: "es-MX",
      REGION_CURRENCY: "mxn",
      REGION_TIMEZONE: "America/Mexico_City",
    });
    expect(invalidas).toEqual([]);
    expect(region).toEqual({
      country: "MX",
      locale: "es-MX",
      currency: "MXN",
      timezone: "America/Mexico_City",
    });
  });

  it("un valor inválido se ignora y se reporta, sin tumbar nada", () => {
    const { region, invalidas } = resolveRegion({
      REGION_COUNTRY: "Colombia",
      REGION_CURRENCY: "pesos",
      REGION_TIMEZONE: "America/Medellin_Inventada",
      REGION_LOCALE: "  ",
    });
    expect(region).toEqual({ ...REGION_DEFAULTS });
    expect(invalidas).toEqual(["REGION_COUNTRY", "REGION_CURRENCY", "REGION_TIMEZONE"]);
  });

  it("getRegion lee el entorno del proceso", () => {
    process.env.REGION_CURRENCY = "USD";
    resetRegionCache();
    expect(getRegion().currency).toBe("USD");
  });

  it("los formatos usan el locale que reciben", () => {
    const fecha = new Date("2026-11-17T15:00:00Z");
    expect(formatDate(fecha, "es-CO", { day: "numeric", month: "long", timeZone: "America/Bogota" })).toBe(
      "17 de noviembre"
    );
    expect(formatNumber(150000, "es-CO")).toBe("150.000");
  });

  it("pnpm doctor avisa (no falla) una variable inválida", () => {
    const res = checkRegion({ REGION_TIMEZONE: "Marte/Olympus" });
    const zona = res.find((r) => r.label === "REGION_TIMEZONE");
    expect(zona?.status).toBe("warn");
    expect(zona?.detail).toContain("America/Bogota");
    expect(res.filter((r) => r.status === "ok")).toHaveLength(3);
  });
});
