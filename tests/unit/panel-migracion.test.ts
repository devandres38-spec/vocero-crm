import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 076 (D16 de Aliantis) — El panel de Andres solo ve agregados. Su rol de
 * base (`vocero_panel`) no tiene permiso sobre ninguna tabla: todo lo que ve
 * sale de las funciones `vocero_panel_*`. Esta prueba, sin base, rompe el CI
 * si una de ellas:
 * - devuelve una columna de texto que no está en la lista blanca (por
 *   ejemplo, el nombre de un contacto o el texto de un mensaje);
 * - lee una tabla con texto de pacientes (contactos, notas, fichas, citas…);
 * - o si la migración le da al panel permisos sobre tablas.
 * La prueba de verdad es contra Postgres real (`scripts/e2e-rls.mjs`).
 */
const RAIZ = path.resolve(__dirname, "../..");
const MIGRACIONES = readdirSync(path.join(RAIZ, "drizzle"))
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(RAIZ, "drizzle", f), "utf8"))
  .join("\n")
  .split(/\r?\n/)
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

/** Texto que el panel sí puede ver: ids, el nombre del negocio y su personal. */
const TEXTO_PERMITIDO = [
  "id",
  "nombre",
  "slug",
  "correo",
  "rol",
  "accion",
  "negocio_id",
  "user_id",
];
const OTROS_TIPOS = ["bigint", "integer", "boolean", "timestamp"];

/** Tablas con texto de pacientes o conversaciones: el panel no las lee ni para contar. */
const PROHIBIDAS = [
  "contact",
  "conversation_note",
  "consent",
  "lead",
  "lead_stage_event",
  "booking",
  "offered_slot",
  "media_asset",
  "ad_attribution",
  "conversion_event",
  "agent_test_case",
  "kb_entry",
  "quick_reply",
  "template",
];

type Funcion = { nombre: string; retorno: string; cuerpo: string };

function funcionesDelPanel(): Funcion[] {
  const re =
    /CREATE OR REPLACE FUNCTION (vocero_panel_\w+)\(([^)]*)\)\s*RETURNS ([\s\S]*?)\s*LANGUAGE[\s\S]*?AS \$\$([\s\S]*?)\$\$;/g;
  const vigentes = new Map<string, Funcion>();
  for (const m of MIGRACIONES.matchAll(re)) {
    vigentes.set(m[1]!, {
      nombre: m[1]!,
      retorno: m[3]!.trim(),
      cuerpo: m[4]!,
    });
  }
  return [...vigentes.values()];
}

function columnas(retorno: string): { nombre: string; tipo: string }[] {
  const tabla = /^TABLE\s*\(([\s\S]*)\)$/.exec(retorno);
  if (!tabla) return [];
  return tabla[1]!
    .split(",")
    .map((c) => c.trim().split(/\s+/))
    .map(([nombre, tipo]) => ({ nombre: nombre!, tipo: tipo! }));
}

describe("076 — las funciones del panel solo devuelven agregados", () => {
  const funciones = funcionesDelPanel();

  it("están las 10 (si cambia, revisa esta prueba)", () => {
    expect(funciones.map((f) => f.nombre).sort()).toEqual(
      [
        "vocero_panel_anotar",
        "vocero_panel_negocios",
        "vocero_panel_pausar",
        "vocero_panel_quien",
        "vocero_panel_quitar_usuario",
        "vocero_panel_registro",
        "vocero_panel_restablecer",
        "vocero_panel_salud",
        "vocero_panel_tope_laboratorio",
        "vocero_panel_usuarios",
      ].sort()
    );
  });

  it("cada columna que devuelven es de un tipo permitido, y el texto, de la lista blanca", () => {
    const malas: string[] = [];
    for (const f of funciones) {
      for (const c of columnas(f.retorno)) {
        const ok =
          (c.tipo === "text" && TEXTO_PERMITIDO.includes(c.nombre)) ||
          (c.tipo === "jsonb" && c.nombre === "detalle") ||
          OTROS_TIPOS.includes(c.tipo);
        if (!ok) malas.push(`${f.nombre}.${c.nombre} ${c.tipo}`);
      }
    }
    expect(malas).toEqual([]);
  });

  it("las que no devuelven tabla, devuelven nada, una fecha, un entero o (la interna) un id", () => {
    const malas = funciones
      .filter((f) => !f.retorno.startsWith("TABLE"))
      .filter((f) => !["void", "timestamp", "integer"].includes(f.retorno))
      .filter((f) => !(f.nombre === "vocero_panel_quien" && f.retorno === "text"))
      .map((f) => `${f.nombre}: ${f.retorno}`);
    expect(malas).toEqual([]);
  });

  it("ninguna lee una tabla con texto de pacientes", () => {
    const malas: string[] = [];
    for (const f of funciones) {
      for (const t of PROHIBIDAS) {
        if (new RegExp(`\\b(FROM|JOIN)\\s+"?${t}"?\\b`, "i").test(f.cuerpo)) {
          malas.push(`${f.nombre} → ${t}`);
        }
      }
    }
    expect(malas).toEqual([]);
  });

  it("ninguna lee columnas de texto de mensajes o conversaciones", () => {
    const malas = funciones
      .filter((f) => /\b\w+\.(text|texto|body|caption|summary|resumen|handoff_reason)\b/.test(f.cuerpo))
      .map((f) => f.nombre);
    expect(malas).toEqual([]);
  });

  it("todas, menos la interna, exigen un superadmin (vocero_panel_quien)", () => {
    // En plpgsql el DECLARE va dentro del cuerpo: `quien text := vocero_panel_quien();`
    // cuenta igual que un `PERFORM vocero_panel_quien();`.
    const sinQuien = funciones
      .filter((f) => f.nombre !== "vocero_panel_quien")
      .filter((f) => !/vocero_panel_quien\(\)/.test(f.cuerpo))
      .map((f) => f.nombre);
    expect(sinQuien).toEqual([]);
  });
});

describe("076 — el rol del panel no tiene tablas", () => {
  it("nunca se le da un permiso sobre tablas ni sobre el esquema más allá de USAGE", () => {
    const grants = [...MIGRACIONES.matchAll(/GRANT ([^;]*?) TO vocero_panel\b/g)].map((m) => m[1]!);
    const malos = grants.filter(
      (g) => !/^EXECUTE ON FUNCTION/.test(g) && !/^USAGE ON SCHEMA "public"$/.test(g)
    );
    expect(malos).toEqual([]);
  });

  it("la app entra al rol sin heredar sus permisos (INHERIT FALSE)", () => {
    expect(MIGRACIONES).toMatch(/GRANT vocero_panel TO vocero_app WITH INHERIT FALSE, SET TRUE;/);
    expect(MIGRACIONES).not.toMatch(/GRANT vocero_panel TO vocero_app;/);
  });

  it("la app no escribe superadministrador ni toca registro_panel", () => {
    expect(MIGRACIONES).toMatch(
      /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "superadministrador" FROM vocero_app;/
    );
    expect(MIGRACIONES).toMatch(/REVOKE ALL ON "registro_panel" FROM vocero_app;/);
  });
});
