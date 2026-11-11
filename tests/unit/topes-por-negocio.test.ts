import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 074 (4.4, N7 del relevo) — Ningún tope global: toda clave de
 * `checkRateLimit` en `src/` lleva el negocio o la IP. Un tope con clave fija
 * haría que un negocio frenara a todos, que es lo que cerró el bloque F en
 * `/api/bot/*`. Si aparece una clave nueva legítima, agrégala aquí con su porqué.
 */
const RAIZ = path.resolve(__dirname, "../../src");

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? archivos(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

function llamadas(): { archivo: string; clave: string }[] {
  const out: { archivo: string; clave: string }[] = [];
  for (const archivo of archivos(RAIZ)) {
    if (archivo.endsWith(path.join("lib", "rate-limit.ts"))) continue;
    const texto = readFileSync(archivo, "utf8");
    for (const m of texto.matchAll(/checkRateLimit\(\s*([^,]+),/g)) {
      out.push({ archivo: path.relative(RAIZ, archivo), clave: m[1]!.trim() });
    }
  }
  return out;
}

describe("074 — topes por negocio, nunca globales", () => {
  it("hay llamadas que revisar (si no, la prueba no prueba nada)", () => {
    expect(llamadas().length).toBeGreaterThanOrEqual(3);
  });

  it("cada clave es una plantilla con el negocio o la IP", () => {
    const globales = llamadas().filter(
      ({ clave }) =>
        !/^`[^`]*\$\{[^}]*\b(organizationId|ip)\b[^}]*\}[^`]*`$/.test(clave)
    );
    expect(globales).toEqual([]);
  });
});
