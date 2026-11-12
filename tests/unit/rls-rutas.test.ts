import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 075 (D4) — Toda ruta y página que toca la base corre dentro de un negocio
 * (o en modo sistema). Sin esto, en producción lanzaría `ConsultaSinNegocio`.
 * Rompe el CI si una ruta nueva se olvida del envoltorio.
 */
const RAIZ = path.resolve(__dirname, "../..");
const APP = path.join(RAIZ, "src/app");

function archivos(dir: string, re: RegExp): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? archivos(p, re) : re.test(n) ? [p] : [];
  });
}
const rel = (p: string) => path.relative(RAIZ, p).split(path.sep).join("/");

/** Las marcas de que la ruta fija su negocio (o corre en sistema, a propósito). */
const ENVOLTORIOS =
  /\b(withAuth|rutaDelCerebro|conNegocio|comoSistema|trabajoDeFondo|paginaConSesion|marcaDeLaPeticion|webhookEntrante|rutaDelPanel)\b/;

/** Rutas que no necesitan envoltorio, con su porqué. */
const SIN_ENVOLTORIO: Record<string, string> = {
  "src/app/api/auth/[...all]/route.ts": "Better Auth: solo sus tablas, por dbDeCuentas",
  "src/app/api/bot/openapi.json/route.ts": "el contrato público, sin base",
  "src/app/api/events/route.ts": "requireSession y el bus en memoria, sin consultas",
  "src/app/api/health/route.ts": "checkHealth corre en comoSistema por dentro",
  "src/app/api/branding/app-icon/route.ts": "appIconResponse usa marcaDeLaPeticion",
  // 076 — El panel de Andres: estas dos van antes de tener el segundo factor.
  "src/app/api/admin/segundo-factor/route.ts":
    "estadoDelPanel (comoSistema por dentro), Better Auth y la marca del TOTP; sin datos de negocios",
  "src/app/api/admin/salir/route.ts": "Better Auth: cierra la sesión",
};

/** 075 — Vacía desde T7: todo punto de entrada fija su negocio. */
const PENDIENTES = new Set<string>([]);

describe("075 — rutas y páginas dentro de un negocio", () => {
  it("toda ruta de /api que toca la base o el servidor pasa por un envoltorio", () => {
    const sueltas = archivos(path.join(APP, "api"), /^route\.tsx?$/)
      .map((p) => ({ p: rel(p), texto: readFileSync(p, "utf8") }))
      // Los mocks que solo usan su estado en memoria (`@/server/dev/…`) no cuentan.
      .filter(({ texto }) => /getDb\(|from "@\/server\/(?!dev\/)/.test(texto))
      .filter(({ p, texto }) => !ENVOLTORIOS.test(texto) && !(p in SIN_ENVOLTORIO) && !PENDIENTES.has(p))
      .map(({ p }) => p);
    expect(sueltas).toEqual([]);
  });

  it("las rutas de /api/bot/* exportan sus métodos con rutaDelCerebro", () => {
    const mal = archivos(path.join(APP, "api/bot"), /^route\.ts$/)
      .map((p) => ({ p: rel(p), texto: readFileSync(p, "utf8") }))
      .filter(({ p }) => !(p in SIN_ENVOLTORIO))
      .filter(
        ({ texto }) =>
          /^export (async )?function (GET|POST|PUT|PATCH|DELETE)\b/m.test(texto) ||
          !/^export const (GET|POST|PUT|PATCH|DELETE) = rutaDelCerebro\(/m.test(texto)
      )
      .map(({ p }) => p);
    expect(mal).toEqual([]);
  });

  it("076 — las rutas de /api/admin/* exportan sus métodos con rutaDelPanel", () => {
    const mal = archivos(path.join(APP, "api/admin"), /^route\.ts$/)
      .map((p) => ({ p: rel(p), texto: readFileSync(p, "utf8") }))
      .filter(({ p }) => !(p in SIN_ENVOLTORIO))
      .filter(
        ({ texto }) =>
          /^export (async )?function (GET|POST|PUT|PATCH|DELETE)\b/m.test(texto) ||
          !/^export const (GET|POST|PUT|PATCH|DELETE) = rutaDelPanel\(/m.test(texto)
      )
      .map(({ p }) => p);
    expect(mal).toEqual([]);
  });

  it("076 — las páginas del panel van en paginaDelPanel (o la del segundo factor)", () => {
    const mal = archivos(path.join(APP, "(admin)"), /^page\.tsx$/)
      .map((p) => ({ p: rel(p), texto: readFileSync(p, "utf8") }))
      .filter(({ texto }) => !/export default (paginaDelPanel|paginaDelSegundoFactor)\(/.test(texto))
      .map(({ p }) => p);
    expect(mal).toEqual([]);
  });

  it("las páginas y layouts del servidor que leen la sesión van en paginaConSesion", () => {
    const mal = archivos(APP, /^(page|layout)\.tsx$/)
      .map((p) => ({ p: rel(p), texto: readFileSync(p, "utf8") }))
      .filter(({ texto }) => !texto.includes('"use client"'))
      .filter(({ texto }) => /getSessionOrNull\(|requireSession\(/.test(texto))
      .filter(({ texto }) => !/export default paginaConSesion\(/.test(texto))
      .map(({ p }) => p);
    expect(mal).toEqual([]);
  });

  it("las excepciones existen (una lista vieja no tapa nada)", () => {
    for (const p of [...Object.keys(SIN_ENVOLTORIO), ...PENDIENTES]) {
      expect(() => statSync(path.join(RAIZ, p)), p).not.toThrow();
    }
  });
});
