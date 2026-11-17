import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { archivosTs, leerSinComentarios, rel, sinComentarios } from "./helpers/fuentes";

/**
 * 068 — Guardarraíl de la constitución XI: ninguna marca cableada en la UI.
 *
 * El producto se distribuye en marca blanca (Aliantis por defecto, y cada
 * negocio con la suya). Un «Vocero» en un texto visible delata el proyecto de
 * origen frente al cliente del cliente. La marca sale de `lib/brand.ts` y
 * `lib/branding.ts`; para hablar del producto sin nombre, «el CRM».
 *
 * Lo técnico NO es marca y no se toca (contrato con el cerebro y datos
 * guardados): cabeceras `x-vocero-*`, `vocero:cerebro:v1`, `VOCERO_MODE`,
 * `/vocero/dispatch`, las claves de tema `vocero`/`vocero-oscuro`, la cookie
 * `vocero-apariencia`. Por eso se busca la palabra con MAYÚSCULA —como se
 * escribe en un texto— y fuera de comentarios.
 */

const PERMITIDOS = new Set([
  // Metadatos del contenedor de audio (campo «vendor» de Ogg): no lo ve nadie.
  "src/lib/audio/webm-ogg.ts",
]);

describe("constitución XI — sin «Vocero» visible en src/", () => {
  it("el filtro de comentarios conserva el código y los textos", () => {
    const fuente = [
      "/* Vocero en un bloque */",
      'const a = "Hola Vocero"; // Vocero en línea',
      "<p>{/* Vocero en JSX */}Hola Vocero</p>",
      'const url = "https://vocero.example";',
    ].join("\n");
    const limpio = sinComentarios(fuente).split("\n");
    expect(limpio).toHaveLength(4);
    expect(limpio[0]).not.toMatch(/Vocero/);
    expect(limpio[1]).toBe('const a = "Hola Vocero"; ');
    expect(limpio[2]).toBe("<p>{}Hola Vocero</p>");
    expect(limpio[3]).toContain("https://vocero.example");
  });

  it("ningún texto de la app menciona la marca de origen", () => {
    const ofensores: string[] = [];
    for (const file of archivosTs(join(process.cwd(), "src"))) {
      const ruta = rel(file);
      if (PERMITIDOS.has(ruta)) continue;
      leerSinComentarios(file)
        .split("\n")
        .forEach((linea, i) => {
          if (/\bVocero\b/.test(linea)) ofensores.push(`${ruta}:${i + 1} ${linea.trim()}`);
        });
    }
    expect(ofensores).toEqual([]);
  });
});
