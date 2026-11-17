import { describe, expect, it } from "vitest";
import {
  correosSuperAdmin,
  dominioBase,
  esPlataforma,
  mcpActivo,
  parseTenancy,
  tenancy,
  validarSlug,
} from "@/lib/tenancy";
import { checkTenancy } from "@/server/doctor/checks";
import { slugDelHost } from "@/server/tenant/host";

describe("069 — modo de despliegue", () => {
  it("sin variable, `single`: la 2.8.0", () => {
    expect(tenancy({})).toBe("single");
    expect(esPlataforma({})).toBe(false);
  });

  it("`multi` en cualquier caja; un valor inválido cae a `single` y se reporta", () => {
    expect(tenancy({ TENANCY: " Multi " })).toBe("multi");
    expect(parseTenancy("saas")).toEqual({ modo: "single", invalida: true });
    expect(parseTenancy("")).toEqual({ modo: "single", invalida: false });
  });

  it("dominio base normalizado; basura → null", () => {
    expect(dominioBase({ PLATFORM_BASE_DOMAIN: "https://Aliantis.co/" })).toBe("aliantis.co");
    expect(dominioBase({ PLATFORM_BASE_DOMAIN: ".aliantis.co:443" })).toBe("aliantis.co");
    expect(dominioBase({ PLATFORM_BASE_DOMAIN: "localhost" })).toBeNull();
    expect(dominioBase({})).toBeNull();
  });

  it("correos de Super-Admin normalizados", () => {
    expect([...correosSuperAdmin({ PLATFORM_ADMIN_EMAILS: " Ops@Agencia.co , ,x" })]).toEqual([
      "ops@agencia.co",
    ]);
  });

  it("el MCP solo existe en `multi` con su bandera", () => {
    expect(mcpActivo({ PLATFORM_MCP: "on" })).toBe(false);
    expect(mcpActivo({ TENANCY: "multi" })).toBe(false);
    expect(mcpActivo({ TENANCY: "multi", PLATFORM_MCP: "on" })).toBe(true);
  });
});

describe("069 — slugs", () => {
  it.each(["ferreteria-rojas", "abc", "clinica-sol-2"])("válido: %s", (s) => {
    expect(validarSlug(s)).toEqual({ ok: true });
  });

  it.each([
    ["ab", "formato"],
    ["-abc", "formato"],
    ["abc-", "formato"],
    ["Ferreteria", "formato"],
    ["ferre_teria", "formato"],
    ["a".repeat(41), "formato"],
    ["xn--abc", "guiones"],
    ["www", "reservado"],
    ["platform", "reservado"],
    ["api", "reservado"],
    ["mcp", "reservado"],
  ])("inválido: %s (%s)", (s, motivo) => {
    expect(validarSlug(s)).toEqual({ ok: false, motivo });
  });
});

describe("069 — organización por host", () => {
  const base = "aliantis.co";
  it("un subdominio de un nivel es un negocio", () => {
    expect(slugDelHost("ferreteria-rojas.aliantis.co", base)).toEqual({
      tipo: "organizacion",
      slug: "ferreteria-rojas",
    });
    expect(slugDelHost("Ferreteria-Rojas.Aliantis.co:443", base)).toEqual({
      tipo: "organizacion",
      slug: "ferreteria-rojas",
    });
  });

  it.each([
    "aliantis.co",
    "www.aliantis.co",
    "a.b.aliantis.co",
    "localhost:3000",
    "10.0.0.2",
    "aliantis.co.evil.com",
    "evilaliantis.co",
  ])("raíz: %s", (h) => {
    expect(slugDelHost(h, base)).toEqual({ tipo: "raiz" });
  });

  it("sin dominio base, todo es raíz", () => {
    expect(slugDelHost("x.aliantis.co", null)).toEqual({ tipo: "raiz" });
  });
});

describe("069 — pnpm doctor", () => {
  it("`single` es ok y no pide nada más", () => {
    const r = checkTenancy({});
    expect(r).toHaveLength(1);
    expect(r[0]?.status).toBe("ok");
  });

  it("`multi` sin dominio base falla; sin admins avisa", () => {
    const r = checkTenancy({ TENANCY: "multi" });
    expect(r.find((x) => x.label === "PLATFORM_BASE_DOMAIN")?.status).toBe("fail");
    expect(r.find((x) => x.label === "PLATFORM_ADMIN_EMAILS")?.status).toBe("warn");
  });

  it("TENANCY inválida y MCP en `single` avisan", () => {
    const r = checkTenancy({ TENANCY: "saas", PLATFORM_MCP: "on" });
    expect(r.find((x) => x.label === "TENANCY")?.status).toBe("warn");
    expect(r.find((x) => x.label === "PLATFORM_MCP")?.status).toBe("warn");
  });
});
