import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 075 (D15 de Aliantis) — Guardarraíles estáticos del RLS. La prueba de
 * verdad es contra Postgres real (`scripts/e2e-rls.mjs`); esta rompe el CI
 * antes, sin base, si:
 * - una tabla con `organization_id` (o `organization`) no tiene RLS y su
 *   política con `USING` y `WITH CHECK` por `app.organization_id`;
 * - aparece una tabla sin `organization_id` que no está en la lista de
 *   excepciones (hay que decidir a propósito);
 * - una función `SECURITY DEFINER` no fija `search_path` o queda para PUBLIC;
 * - alguien usa `FORCE ROW LEVEL SECURITY` (rompería las funciones de solo ids).
 */
const RAIZ = path.resolve(__dirname, "../..");
const SCHEMA = readFileSync(path.join(RAIZ, "src/lib/db/schema.ts"), "utf8");
const MIGRACIONES = readdirSync(path.join(RAIZ, "drizzle"))
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(RAIZ, "drizzle", f), "utf8"))
  .join("\n")
  // Sin comentarios SQL: una política comentada no cuenta.
  .split(/\r?\n/)
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

/** Sin RLS a propósito (spec 075, D1): Better Auth las lee antes de saber el negocio. */
const SIN_RLS = ["user", "session", "account", "verification"];

const CONDICION = "NULLIF(current_setting('app.organization_id', true), '')";

function tablas(): { nombre: string; conOrg: boolean }[] {
  const out: { nombre: string; conOrg: boolean }[] = [];
  const re = /export const \w+ = pgTable\(\s*"([^"]+)"/g;
  const inicios = [...SCHEMA.matchAll(re)];
  inicios.forEach((m, i) => {
    const fin = inicios[i + 1]?.index ?? SCHEMA.length;
    const cuerpo = SCHEMA.slice(m.index!, fin);
    out.push({ nombre: m[1]!, conOrg: /organization_id/.test(cuerpo) && m[1] !== "session" });
  });
  return out;
}

function escapar(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("075 — RLS: toda tabla de negocio con su política", () => {
  it("el inventario es el esperado (42 tablas; si cambia, revisa esta prueba)", () => {
    expect(tablas().length).toBeGreaterThanOrEqual(42);
  });

  it("toda tabla sin organization_id está en la lista de excepciones", () => {
    const sinOrg = tablas()
      .filter((t) => !t.conOrg && t.nombre !== "organization")
      .map((t) => t.nombre);
    expect(sinOrg.sort()).toEqual([...SIN_RLS].sort());
  });

  it("cada tabla con organization_id, y organization, tiene RLS y su política con USING y WITH CHECK", () => {
    const faltan: string[] = [];
    for (const t of tablas()) {
      if (SIN_RLS.includes(t.nombre)) continue;
      const col = t.nombre === "organization" ? "id" : "organization_id";
      const habilitada = new RegExp(
        `ALTER TABLE "${escapar(t.nombre)}" ENABLE ROW LEVEL SECURITY;`
      ).test(MIGRACIONES);
      const politica = new RegExp(
        `CREATE POLICY "[^"]+" ON "${escapar(t.nombre)}"\\s+` +
          `USING \\("${col}" = ${escapar(CONDICION)}\\)\\s+` +
          `WITH CHECK \\("${col}" = ${escapar(CONDICION)}\\);`
      ).test(MIGRACIONES);
      if (!habilitada || !politica) faltan.push(t.nombre);
    }
    expect(faltan).toEqual([]);
  });

  it("nunca FORCE ROW LEVEL SECURITY", () => {
    expect(MIGRACIONES).not.toMatch(/FORCE ROW LEVEL SECURITY/i);
  });
});

describe("075 — funciones SECURITY DEFINER", () => {
  const definidas = [
    ...MIGRACIONES.matchAll(
      /CREATE OR REPLACE FUNCTION (\w+)\(([^)]*)\)[\s\S]*?AS \$\$/g
    ),
  ].filter((m) => /SECURITY DEFINER/.test(m[0]));

  it("hay funciones que revisar", () => {
    expect(definidas.length).toBeGreaterThanOrEqual(10);
  });

  it("cada una fija search_path", () => {
    const sinRuta = definidas
      .filter((m) => !/SET search_path = public, pg_temp/.test(m[0]))
      .map((m) => m[1]);
    expect(sinRuta).toEqual([]);
  });

  it("cada una se le quita a PUBLIC y se le da solo a vocero_app", () => {
    const revoke = /REVOKE ALL ON FUNCTION([\s\S]*?)FROM PUBLIC;/.exec(MIGRACIONES)?.[1] ?? "";
    const grant = /GRANT EXECUTE ON FUNCTION([\s\S]*?)TO vocero_app;/.exec(MIGRACIONES)?.[1] ?? "";
    const faltan = definidas
      .map((m) => m[1]!)
      .filter((n) => !revoke.includes(`${n}(`) || !grant.includes(`${n}(`));
    expect(faltan).toEqual([]);
  });

  it("ninguna escribe (solo SELECT)", () => {
    const escriben = definidas
      .map((m) => {
        const cuerpo = MIGRACIONES.slice(m.index!).split("$$")[1] ?? "";
        return { n: m[1], cuerpo };
      })
      .filter(({ cuerpo }) => /\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(cuerpo))
      .map(({ n }) => n);
    expect(escriben).toEqual([]);
  });
});
