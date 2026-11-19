import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CLAVES_TRATO, esTrato, tratoDe, TRATOS } from "@/lib/agent-roles";
import { catalogoPlataforma, EJEMPLO_COMPLETO } from "@/server/platform/catalogo";
import { blueprintSchema } from "@/lib/platform/blueprint";

/**
 * 071 (bloque C) — El trato del agente y el cierre sin rumbo: catálogo,
 * reglas de caída, migración aditiva y su lugar en el catálogo del MCP.
 */

const RAIZ = path.resolve(import.meta.dirname, "..", "..");

describe("071 — catálogo de tratos", () => {
  it("las claves son contrato con el cerebro", () => {
    expect(CLAVES_TRATO).toEqual(["tu", "usted", "neutro"]);
    expect(TRATOS.every((t) => t.etiqueta && t.descripcion)).toBe(true);
  });

  it("lo desconocido cae a `tu`, igual que en el cerebro", () => {
    expect(tratoDe("usted")).toBe("usted");
    expect(tratoDe("vos")).toBe("tu");
    expect(tratoDe(null)).toBe("tu");
    expect(tratoDe(undefined)).toBe("tu");
    expect(esTrato("neutro")).toBe(true);
    expect(esTrato("Usted")).toBe(false);
  });
});

describe("071 — migración 0031_agente_trato", () => {
  const sql = readFileSync(path.join(RAIZ, "drizzle", "0031_agente_trato.sql"), "utf8");

  it("es aditiva y re-ejecutable", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "treatment" text DEFAULT 'tu' NOT NULL/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "stall_enabled" boolean DEFAULT true NOT NULL/);
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS "agent_profile_treatment_ck"/);
    expect(sql).not.toMatch(/DROP COLUMN|DROP TABLE|ALTER COLUMN/);
  });

  it("está en el journal de drizzle", () => {
    const journal = JSON.parse(readFileSync(path.join(RAIZ, "drizzle", "meta", "_journal.json"), "utf8")) as {
      entries: { tag: string }[];
    };
    // 072: ya no es la última; lo que importa es que esté (y una sola vez).
    expect(journal.entries.filter((e) => e.tag === "0031_agente_trato")).toHaveLength(1);
  });
});

describe("071 — catálogo de la plataforma (MCP get_catalog)", () => {
  it("ofrece los tratos y los defaults, y el ejemplo completo es válido", () => {
    const c = catalogoPlataforma() as unknown as { agent: { treatments: { key: string }[]; defaults: unknown } };
    expect(c.agent.treatments.map((t) => t.key)).toEqual(["tu", "usted", "neutro"]);
    expect(c.agent.defaults).toEqual({ treatment: "tu", stallEnabled: true });
    expect(blueprintSchema.safeParse(EJEMPLO_COMPLETO).success).toBe(true);
  });

  it("el JSON Schema del contrato trae los campos nuevos", () => {
    const texto = JSON.stringify((catalogoPlataforma() as unknown as { schema: unknown }).schema);
    expect(texto).toContain('"treatment"');
    expect(texto).toContain('"stallEnabled"');
  });
});
