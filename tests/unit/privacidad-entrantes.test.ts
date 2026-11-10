import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 069 — Todo mensaje entrante que se guarda pasa por el filtro de privacidad.
 * Un camino nuevo que inserte un entrante (`direction: "in"`) sin filtrar
 * rompe esta prueba: hay que pasarlo por `ingestInboundMessage` o por
 * `filtrarTexto`, o justificarlo aquí.
 */
function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivos(ruta);
    return /\.(ts|tsx)$/.test(nombre) ? [ruta] : [];
  });
}

const normal = (ruta: string) => ruta.split(/[\\/]/).join("/");

/** Quién puede insertar un entrante, y con qué filtro. */
const PERMITIDOS: Record<string, RegExp | null> = {
  // La ingesta de los cuatro canales: marcas de guardarEvento o segunda red.
  "src/server/inbox/ingest.ts": /textoFiltrado\(input\)/,
  // El Laboratorio: la persona de prueba (D6).
  "src/server/lab/runner.ts": /filtrarTexto\(line, politica\)/,
  // La demo: mensajes inventados, no de un paciente (spec 069, lo que no hace).
  "src/server/seed/demo.ts": null,
};

describe("069 — ningún entrante se guarda sin filtrar", () => {
  it("solo la ingesta, el Laboratorio y la demo insertan entrantes", () => {
    const conEntrantes = archivos("src")
      .filter((ruta) => /direction:\s*"in"/.test(readFileSync(ruta, "utf8")))
      .filter((ruta) => /insert\(\s*schema\.message\s*\)/.test(readFileSync(ruta, "utf8")))
      .map(normal);
    expect(conEntrantes.filter((r) => !(r in PERMITIDOS))).toEqual([]);
  });

  it("la ingesta y el Laboratorio filtran antes de insertar", () => {
    for (const [ruta, filtro] of Object.entries(PERMITIDOS)) {
      if (!filtro) continue;
      const texto = readFileSync(ruta, "utf8");
      const filtra = texto.search(filtro);
      const inserta = texto.indexOf('direction: "in"', filtra);
      expect(filtra, ruta).toBeGreaterThan(-1);
      expect(inserta, ruta).toBeGreaterThan(filtra);
    }
  });
});
