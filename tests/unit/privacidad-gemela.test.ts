import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  perfilPrivacidadSchema,
  politicaDesdePerfil,
  type PerfilPrivacidad,
} from "@/server/privacy/perfil";
import {
  classifyAndMask,
  privacyFlagsOf,
  withoutReview,
} from "@/server/privacy/privacy-filter";

/**
 * 068 — La prueba gemela del filtro de privacidad (D7).
 *
 * El cerebro (aliantis-brain) genera los vectores con SU implementación, que es
 * la de referencia (`npm run privacidad:vectores`), y tiene esta misma prueba
 * sobre el mismo archivo y con la misma huella. Cambiar el filtro de un solo
 * lado rompe una prueba, no una instalación.
 *
 * Si el filtro cambia a propósito: regenerar en el cerebro, copiar
 * `test/fixtures/privacidad-vectores.json` a `tests/unit/fixtures/` y poner la
 * huella nueva aquí y allá.
 */
const HUELLA_VECTORES =
  "bfd81658e75a7ec914ad85947795b991ece559c1f138fcfdddde594b530807fc";

interface Caso {
  perfil: string | null;
  texto: string;
  boton?: string | null;
  esperado: unknown;
}

interface Vectores {
  formato: 1;
  libphonenumber: string;
  perfiles: Record<string, PerfilPrivacidad>;
  casos: Caso[];
}

// Saltos LF: en Windows, git deja el archivo con CRLF en el disco.
const contenido = readFileSync(
  "tests/unit/fixtures/privacidad-vectores.json",
  "utf8"
).replace(/\r\n/g, "\n");
const vectores = JSON.parse(contenido) as Vectores;

describe("068 — vectores gemelos del filtro de privacidad", () => {
  it("el archivo es el fijado en las dos pruebas gemelas", () => {
    expect(createHash("sha256").update(contenido).digest("hex")).toBe(
      HUELLA_VECTORES
    );
  });

  it("se generaron con la misma versión de libphonenumber-js que está instalada (D8)", () => {
    const require = createRequire(import.meta.url);
    const { version } = require("libphonenumber-js/package.json") as {
      version: string;
    };
    expect(vectores.libphonenumber).toBe(version);
  });

  it("cada perfil cumple el contrato y su huella cuadra", () => {
    for (const [clave, perfil] of Object.entries(vectores.perfiles)) {
      expect(perfilPrivacidadSchema.safeParse(perfil).success, clave).toBe(
        true
      );
    }
  });

  it("cada caso da exactamente lo que da el cerebro", () => {
    const distintos = vectores.casos.filter((caso) => {
      const perfil =
        caso.perfil === null ? null : vectores.perfiles[caso.perfil];
      if (caso.perfil !== null && !perfil) return true;
      const result = perfil
        ? classifyAndMask(caso.texto, politicaDesdePerfil(perfil))
        : withoutReview(caso.texto, caso.boton ?? undefined);
      return (
        canonicalJson({ ...result, flags: privacyFlagsOf(result) }) !==
        canonicalJson(caso.esperado)
      );
    });
    expect(
      distintos.map((caso) => `${caso.perfil ?? "-"}: ${caso.texto}`)
    ).toEqual([]);
    expect(vectores.casos.length).toBeGreaterThanOrEqual(290);
  });
});
