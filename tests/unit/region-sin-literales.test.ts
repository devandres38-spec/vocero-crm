import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { archivosTs, leerSinComentarios, rel } from "./helpers/fuentes";

/**
 * 068 — Guardarraíl de la constitución XI: ningún valor regional cableado.
 *
 * El formato de fechas, la moneda por defecto y la zona salen de
 * `src/lib/region.ts`. Antes de la 068 había ~40 `es-MX`, `MXN` y
 * `America/Mexico_City` sueltos, y servir a Colombia exigía buscarlos uno por
 * uno. Si esto se pone rojo: usa `getRegion()` (servidor) o `useRegion()`
 * (cliente), o agrega el archivo a la lista si es un CATÁLOGO de opciones.
 */

const PERMITIDOS = new Set([
  "src/lib/region.ts", // la fuente de los defaults
  "src/lib/money.ts", // catálogo de monedas
]);

const LITERALES: { nombre: string; re: RegExp }[] = [
  { nombre: "locale", re: /["'`]es-(MX|CO)["'`]/ },
  { nombre: "zona", re: /["'`]America\/(Mexico_City|Bogota)["'`]/ },
  { nombre: "moneda", re: /["'`](MXN|COP)["'`]/ },
];

describe("constitución XI — sin valores regionales cableados en src/", () => {
  it("solo region.ts y los catálogos los mencionan", () => {
    const ofensores: string[] = [];
    for (const file of archivosTs(join(process.cwd(), "src"))) {
      const ruta = rel(file);
      if (PERMITIDOS.has(ruta)) continue;
      const lineas = leerSinComentarios(file).split("\n");
      lineas.forEach((linea, i) => {
        for (const { nombre, re } of LITERALES) {
          if (re.test(linea)) ofensores.push(`${ruta}:${i + 1} (${nombre}) ${linea.trim()}`);
        }
      });
    }
    expect(ofensores).toEqual([]);
  });
});
