import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 076 (D16 de Aliantis) — El candado de privacidad del panel de Andres, en el
 * código. El panel nunca ve conversaciones, mensajes, notas, fichas ni datos
 * de pacientes: solo agregados. En la base lo garantiza el rol
 * `vocero_panel` (sin tablas); esta prueba rompe el CI antes si el código del
 * panel:
 * - importa la base (`@/lib/db`, `drizzle-orm`, `postgres`) fuera de los tres
 *   módulos declarados, cada uno con lo único que puede usar;
 * - llega, directo o a través de otros módulos, a un módulo de dominio con
 *   datos de pacientes (bandeja, contactos, fichas, notas, Laboratorio…);
 * - entra a un negocio o al modo sistema (`conNegocio`, `comoSistema`,
 *   `trabajoDeFondo`) fuera de lo declarado;
 * - nombra en su SQL una tabla de pacientes o conversaciones.
 */
const RAIZ = path.resolve(__dirname, "../..");
const SRC = path.join(RAIZ, "src");

/** Dónde vive el panel. */
const RAICES_DEL_PANEL = [
  "src/app/(admin)",
  "src/app/api/admin",
  "src/server/panel",
  "src/components/panel",
];

/**
 * Los únicos del panel que tocan la base, y con qué:
 * - `datos.ts`: `getDb` para llamar a `vocero_panel_*`, dentro de `comoPanel`;
 * - `guard.ts`: lee `superadministrador` (sin RLS) en `comoSistema`, ANTES de
 *   entrar al panel;
 * - `alta.ts`: el alta de un negocio con `crearNegocio()` (escribe; no lee
 *   pacientes), fuera del panel, y la anota con `datos.ts`.
 */
const DECLARADOS: Record<string, { db: boolean; contexto: string[] }> = {
  "src/server/panel/datos.ts": { db: true, contexto: [] },
  "src/server/panel/guard.ts": { db: true, contexto: ["comoSistema"] },
  "src/server/panel/alta.ts": { db: true, contexto: [] },
};

/** Módulos con datos de pacientes o conversaciones: el panel no llega a ellos por ningún camino. */
const PROHIBIDOS = [
  "src/server/inbox",
  "src/server/contacts.ts",
  "src/server/contacts-import.ts",
  "src/server/contact-source.ts",
  "src/server/notas.ts",
  "src/server/consent.ts",
  "src/server/leads",
  "src/server/lab",
  "src/server/privacy",
  "src/server/webhooks",
  "src/server/dispatch",
  "src/server/agenda",
  "src/server/attribution",
  "src/server/analytics",
  "src/server/events",
  "src/server/whatsapp",
  "src/server/instagram",
  "src/server/messenger",
  "src/server/tiktok",
  "src/server/zernio",
  "src/server/bot",
  "src/server/retencion",
  "src/app/api/conversations",
  "src/app/api/contacts",
  "src/app/api/bookings",
  "src/app/api/lab",
  "src/app/api/bot",
];

/**
 * Dentro de una carpeta prohibida, lo que sí puede usar el panel (y se sigue
 * revisando lo que ESOS importan): el `/health` del cerebro, que es una
 * llamada de red sin datos de nadie y solo importa `@/lib/brain-status`.
 */
const EXCEPCIONES = ["src/server/bot/status.ts"];

/** Tablas que el SQL del panel no puede nombrar (lo que lee lo leen las funciones). */
const TABLAS_DE_PACIENTES = [
  "message",
  "conversation",
  "conversation_note",
  "contact",
  "lead",
  "booking",
  "consent",
  "webhook_event",
  "media_asset",
  "agent_test_run",
  "agent_test_case",
  "ad_attribution",
  "olvido_pendiente",
  "dispatch",
];

function archivos(dir: string): string[] {
  const abs = path.join(RAIZ, dir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for (const nombre of readdirSync(abs)) {
    const rel = path.posix.join(dir, nombre);
    if (statSync(path.join(RAIZ, rel)).isDirectory()) out.push(...archivos(rel));
    else if (/\.(ts|tsx)$/.test(nombre)) out.push(rel);
  }
  return out;
}

const DEL_PANEL = RAICES_DEL_PANEL.flatMap(archivos);
const esDelPanel = (rel: string) => RAICES_DEL_PANEL.some((r) => rel.startsWith(`${r}/`));

/** El código de un archivo sin comentarios: un nombre citado en un comentario no cuenta. */
function codigo(rel: string): string {
  return readFileSync(path.join(RAIZ, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** Los especificadores que importa un archivo (estáticos y dinámicos). */
function importaciones(rel: string): string[] {
  const texto = readFileSync(path.join(RAIZ, rel), "utf8");
  const out: string[] = [];
  for (const m of texto.matchAll(/(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/g)) out.push(m[1]!);
  for (const m of texto.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1]!);
  for (const m of texto.matchAll(/^import\s+["']([^"']+)["']/gm)) out.push(m[1]!);
  return out;
}

/** Un especificador a un archivo de `src/` (o `null` si es un paquete). */
function resolver(desde: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.join(RAIZ, path.dirname(desde)), spec);
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(c) && statSync(c).isFile()) return path.relative(RAIZ, c).split(path.sep).join("/");
  }
  return null;
}

const esBase = (rel: string | null, spec: string) =>
  spec === "drizzle-orm" ||
  spec.startsWith("drizzle-orm/") ||
  spec === "postgres" ||
  (rel !== null && rel.startsWith("src/lib/db/") && rel !== "src/lib/db/contexto.ts");

describe("076 — el candado del panel (D16)", () => {
  it("el panel existe donde se busca (si se mueve, actualiza esta prueba)", () => {
    expect(DEL_PANEL).toContain("src/server/panel/datos.ts");
  });

  it("solo los módulos declarados importan la base", () => {
    const malos: string[] = [];
    for (const f of DEL_PANEL) {
      for (const spec of importaciones(f)) {
        if (esBase(resolver(f, spec), spec) && !DECLARADOS[f]?.db) malos.push(`${f} → ${spec}`);
      }
    }
    expect(malos).toEqual([]);
  });

  it("nadie del panel llega a un módulo con datos de pacientes, ni a través de otros", () => {
    const caminos: string[] = [];
    const visto = new Set<string>();
    const pila: { rel: string; camino: string[] }[] = DEL_PANEL.map((rel) => ({ rel, camino: [rel] }));
    while (pila.length > 0) {
      const { rel, camino } = pila.pop()!;
      if (visto.has(rel)) continue;
      visto.add(rel);
      for (const spec of importaciones(rel)) {
        const destino = resolver(rel, spec);
        if (!destino) continue;
        if (
          !EXCEPCIONES.includes(destino) &&
          PROHIBIDOS.some((p) => destino === p || destino.startsWith(`${p}/`))
        ) {
          caminos.push([...camino, destino].join(" → "));
          continue;
        }
        if (!visto.has(destino)) pila.push({ rel: destino, camino: [...camino, destino] });
      }
    }
    expect(caminos).toEqual([]);
  });

  it("nadie del panel entra a un negocio, al modo sistema o a un trabajo de fondo (salvo lo declarado)", () => {
    const malos: string[] = [];
    for (const f of DEL_PANEL) {
      const texto = codigo(f);
      for (const fn of ["conNegocio", "comoSistema", "trabajoDeFondo"]) {
        if (new RegExp(`\\b${fn}\\b`).test(texto) && !DECLARADOS[f]?.contexto.includes(fn)) {
          malos.push(`${f} usa ${fn}`);
        }
      }
    }
    expect(malos).toEqual([]);
  });

  it("solo alta.ts usa crearNegocio, y solo guard.ts nombra una tabla (superadministrador)", () => {
    const malos: string[] = [];
    for (const f of DEL_PANEL) {
      const texto = codigo(f);
      if (/\bcrearNegocio\b/.test(texto) && f !== "src/server/panel/alta.ts") malos.push(`${f}: crearNegocio`);
      if (/\bschema\.\w+/.test(texto)) malos.push(`${f}: schema.*`);
    }
    expect(malos).toEqual([]);
  });

  it("el SQL del panel no nombra tablas de pacientes ni de conversaciones", () => {
    const malos: string[] = [];
    for (const f of DEL_PANEL) {
      const texto = codigo(f);
      for (const bloque of texto.matchAll(/sql`([\s\S]*?)`/g)) {
        for (const t of TABLAS_DE_PACIENTES) {
          if (new RegExp(`\\b(from|join|into|update)\\s+"?${t}"?\\b`, "i").test(bloque[1]!)) {
            malos.push(`${f} → ${t}`);
          }
        }
      }
    }
    expect(malos).toEqual([]);
  });

  it("solo la ruta del alta corre fuera del rol del panel (fueraDelPanel)", () => {
    const usan = DEL_PANEL.filter((f) => f !== "src/server/panel/ruta.ts").filter((f) =>
      /\bfueraDelPanel\b/.test(codigo(f))
    );
    expect(usan).toEqual(["src/app/api/admin/negocios/route.ts"]);
  });

  it("datos.ts solo llama a funciones vocero_panel_* (ningún from de una tabla)", () => {
    const texto = readFileSync(path.join(RAIZ, "src/server/panel/datos.ts"), "utf8");
    const desde = [...texto.matchAll(/\bfrom\s+(\w+)/gi)]
      .map((m) => m[1]!)
      .filter((n) => !["drizzle"].includes(n));
    const malas = desde.filter((n) => !n.startsWith("vocero_panel_"));
    // Los `from "…"` de los import no cuentan: empiezan por comilla.
    expect(malas).toEqual([]);
  });

  it("las rutas y las páginas del panel no son de otra carpeta (las del negocio no importan el panel)", () => {
    const fuera = archivos("src")
      .filter((f) => !esDelPanel(f))
      .filter((f) => !f.startsWith("src/server/panel/"))
      .filter((f) =>
        importaciones(f).some((s) => {
          const r = resolver(f, s);
          return r !== null && (r.startsWith("src/server/panel/datos") || r.startsWith("src/server/panel/alta"));
        })
      );
    expect(fuera).toEqual([]);
  });

});
