import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 068 — El filtro de privacidad es del servidor: `libphonenumber-js/max` pesa
 * y las listas de salud no tienen nada que hacer en el navegador. Ningún
 * componente de cliente ni nada bajo `src/components/` importa
 * `@/server/privacy`.
 */
function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivos(ruta);
    return /\.(ts|tsx)$/.test(nombre) ? [ruta] : [];
  });
}

describe("068 — el filtro no llega al navegador", () => {
  it("ningún archivo de cliente importa @/server/privacy", () => {
    const culpables = archivos("src").filter((ruta) => {
      const texto = readFileSync(ruta, "utf8");
      const esCliente =
        /^\s*["']use client["']/m.test(texto) ||
        ruta.split(/[\\/]/).includes("components");
      return esCliente && /["']@\/server\/privacy(\/|["'])/.test(texto);
    });
    expect(culpables).toEqual([]);
  });
});

describe("068 — solo Andres registra un perfil de privacidad (D5)", () => {
  it("nada fuera de src/server/privacy y scripts/ lo escribe", () => {
    const escritores =
      /\b(sembrarPerfil|sembrarPerfilDemo|guardarPerfil)\b|insert\(\s*schema\.privacyProfile/;
    const culpables = archivos("src").filter((ruta) => {
      const partes = ruta.split(/[\\/]/);
      if (partes.slice(0, 3).join("/") === "src/server/privacy") return false;
      return escritores.test(readFileSync(ruta, "utf8"));
    });
    expect(culpables).toEqual([]);
  });
});
