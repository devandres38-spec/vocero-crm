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

/**
 * Sin RLS a propósito. Spec 075, D1: Better Auth las lee antes de saber el
 * negocio. Spec 076: el segundo factor (Better Auth), quién es superadmin y el
 * registro del panel no son de ningún negocio.
 */
const SIN_RLS = [
  "user",
  "session",
  "account",
  "verification",
  "two_factor",
  "superadministrador",
  "registro_panel",
];

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
  it("el inventario es el esperado (45 tablas; si cambia, revisa esta prueba)", () => {
    expect(tablas().length).toBeGreaterThanOrEqual(45);
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

  const todos = (re: RegExp) =>
    [...MIGRACIONES.matchAll(re)].map((m) => m[1] ?? "").join("\n");
  // `[^;]`: cada captura es UNA sentencia, sin saltar a la siguiente.
  const revoke = todos(/REVOKE ALL ON FUNCTION([^;]*?)FROM PUBLIC;/g);
  const grantApp = todos(/GRANT EXECUTE ON FUNCTION([^;]*?)TO vocero_app;/g);
  const grantPanel = todos(/GRANT EXECUTE ON FUNCTION([^;]*?)TO vocero_panel;/g);

  /** 076 — Las llaman otras funciones o un trigger, nunca la app. */
  const INTERNAS = ["vocero_panel_quien", "vocero_member_sin_superadmin"];

  it("cada una se le quita a PUBLIC", () => {
    const faltan = definidas.map((m) => m[1]!).filter((n) => !revoke.includes(`${n}(`));
    expect(faltan).toEqual([]);
  });

  it("las de la app, solo a vocero_app; las del panel, solo a vocero_panel (076)", () => {
    const mal = definidas
      .map((m) => m[1]!)
      .filter((n) => !INTERNAS.includes(n))
      .filter((n) => {
        const app = grantApp.includes(`${n}(`);
        const panel = grantPanel.includes(`${n}(`);
        return n.startsWith("vocero_panel_") ? app || !panel : !app || panel;
      });
    expect(mal).toEqual([]);
  });

  it("las internas no se le dan a nadie (076)", () => {
    const dadas = INTERNAS.filter(
      (n) => grantApp.includes(`${n}(`) || grantPanel.includes(`${n}(`)
    );
    expect(dadas).toEqual([]);
  });

  /**
   * 076 — Las únicas que escriben: el panel (pausar, restablecer, quitar,
   * anotar) y marcar el TOTP del superadmin. Cualquier otra, solo SELECT.
   */
  const ESCRIBEN = [
    "vocero_superadmin_marcar_totp",
    "vocero_panel_pausar",
    "vocero_panel_restablecer",
    "vocero_panel_quitar_usuario",
    "vocero_panel_anotar",
  ];

  it("ninguna escribe (solo SELECT), salvo las declaradas", () => {
    const escriben = definidas
      .map((m) => {
        const cuerpo = MIGRACIONES.slice(m.index!).split("$$")[1] ?? "";
        return { n: m[1], cuerpo };
      })
      .filter(({ cuerpo }) => /\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(cuerpo))
      .map(({ n }) => n!)
      .filter((n) => !ESCRIBEN.includes(n));
    expect(escriben).toEqual([]);
  });
});
