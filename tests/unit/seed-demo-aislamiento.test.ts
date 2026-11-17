import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { DEMO_PHONES, filtroContactosDemo } from "@/server/seed/demo";
import { PERSONAS } from "@/server/lab/personas";

/**
 * 068 — La limpieza de la demo borraba contactos por teléfono SIN filtrar la
 * organización: sembrar la demo en el negocio B borraba los contactos demo del
 * negocio A (y sus conversaciones, mensajes y leads). Constitución I: prueba
 * de cruce. Se lee el SQL que de verdad se manda a Postgres.
 */

const dialect = new PgDialect();

describe("068 — la demo solo limpia lo suyo", () => {
  it("el filtro exige la organización Y los teléfonos de la demo", () => {
    const { sql, params } = dialect.sqlToQuery(filtroContactosDemo("org_B"));
    expect(sql).toMatch(/"contact"\."organization_id" = \$1/);
    expect(sql).toMatch(/"contact"\."phone" in \(/);
    expect(sql).toMatch(/ and /);
    expect(params[0]).toBe("org_B");
    expect(params).not.toContain("org_A");
  });

  it("dos organizaciones producen filtros distintos: B nunca alcanza a A", () => {
    const a = dialect.sqlToQuery(filtroContactosDemo("org_A"));
    const b = dialect.sqlToQuery(filtroContactosDemo("org_B"));
    expect(a.sql).toBe(b.sql);
    expect(a.params[0]).toBe("org_A");
    expect(b.params[0]).toBe("org_B");
  });

  it("limpia también la demo mexicana anterior, para no duplicarla", () => {
    expect(DEMO_PHONES).toContain("570000000101");
    expect(DEMO_PHONES).toContain("5215612340001");
    expect(DEMO_PHONES).toContain("5215612340008");
  });
});

describe("068 — teléfonos sintéticos que jamás son reales", () => {
  // Tras el 57, ningún número colombiano empieza por 0.
  const sintetico = /^570\d{9}$/;

  it("los de la demo nueva", () => {
    for (const phone of DEMO_PHONES.filter((p) => p.startsWith("57"))) {
      expect(phone, phone).toMatch(sintetico);
    }
  });

  it("los de las personas del Laboratorio", () => {
    for (const p of PERSONAS) expect(p.phone, p.key).toMatch(sintetico);
    expect(new Set(PERSONAS.map((p) => p.phone)).size).toBe(PERSONAS.length);
  });

  it("la persona de modismos habla como colombiana", () => {
    const modismos = PERSONAS.find((p) => p.key === "errores_modismos");
    expect(modismos?.description).toContain("colombianos");
    expect(modismos?.script.join(" ")).toMatch(/kiubo|parce|de una/);
  });
});
