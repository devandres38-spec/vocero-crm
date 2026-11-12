import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 080 (T3) — El tope del Laboratorio en la base: 3 por defecto, de 0 a 20,
 * que solo escribe el panel; la app pierde UPDATE sobre él y sobre la pausa,
 * y las llaves de los negocios se borran (P1, P5). La prueba de verdad es
 * contra Postgres real (`e2e-rls`).
 */
const SQL = readFileSync(
  path.resolve(__dirname, "../../drizzle/0037_laboratorio_tope.sql"),
  "utf8"
);
/** Sin comentarios: lo que se ejecuta. */
const EJECUTA = SQL.replace(/--.*$/gm, "");

describe("080 — la migración del tope", () => {
  it("la columna: 3 por defecto, NOT NULL, CHECK de 0 a 20", () => {
    expect(SQL).toContain(
      `ALTER TABLE "organization" ADD COLUMN "lab_corridas_por_dia" integer DEFAULT 3 NOT NULL;`
    );
    expect(SQL).toMatch(/CHECK \("organization"\."lab_corridas_por_dia" BETWEEN 0 AND 20\)/);
  });

  it("vocero_app pierde UPDATE de tabla y lo recupera solo en name, slug, logo y metadata", () => {
    expect(EJECUTA).toMatch(/REVOKE UPDATE ON "organization" FROM vocero_app;/);
    const grant = EJECUTA.match(/GRANT UPDATE \(([^)]*)\) ON "organization" TO vocero_app;/);
    expect(grant).not.toBeNull();
    const cols = grant![1]!.split(",").map((c) => c.trim().replace(/"/g, ""));
    expect(new Set(cols)).toEqual(new Set(["name", "slug", "logo", "metadata"]));
    expect(cols).not.toContain("lab_corridas_por_dia");
    expect(cols).not.toContain("pausado_en");
    // El REVOKE va antes del GRANT: al revés, el GRANT de columnas no serviría de nada.
    expect(EJECUTA.indexOf("REVOKE UPDATE")).toBeLessThan(EJECUTA.indexOf("GRANT UPDATE"));
  });

  it("borra las llaves de los negocios (P5)", () => {
    expect(EJECUTA).toMatch(/DELETE FROM "ai_credentials";/);
  });

  it("la función del panel valida 0-20, exige superadmin y anota tope_laboratorio", () => {
    const f = EJECUTA.slice(EJECUTA.indexOf("FUNCTION vocero_panel_tope_laboratorio"));
    const cuerpo = f.split("$$")[1] ?? "";
    expect(f).toMatch(/SECURITY DEFINER SET search_path = public, pg_temp/);
    expect(cuerpo).toContain("vocero_panel_quien()");
    expect(cuerpo).toMatch(/p_tope < 0 OR p_tope > 20/);
    expect(cuerpo).toContain("'tope_laboratorio'");
    expect(cuerpo).toContain("jsonb_build_object('tope', p_tope)");
    expect(EJECUTA).toMatch(
      /GRANT EXECUTE ON FUNCTION[^;]*vocero_panel_tope_laboratorio\(text, integer\)[^;]*TO vocero_panel;/
    );
  });

  it("vocero_panel_negocios devuelve el tope y las corridas de hoy, y se vuelve a dar al panel", () => {
    expect(EJECUTA).toContain("DROP FUNCTION IF EXISTS vocero_panel_negocios();");
    expect(EJECUTA).toMatch(/lab_tope integer, lab_corridas_hoy bigint/);
    expect(EJECUTA).toMatch(/r\.started_at >= date_trunc\('day', ahora\)/);
    expect(EJECUTA).toMatch(/GRANT EXECUTE ON FUNCTION vocero_panel_negocios\(\)[^;]*TO vocero_panel;/);
  });
});
