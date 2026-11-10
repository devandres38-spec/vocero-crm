import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  huellaDePerfil,
  perfilPrivacidadSchema,
  type PerfilPrivacidad,
} from "@/server/privacy/perfil";

/**
 * 068 — El perfil de privacidad que exporta el cerebro
 * (`contracts/perfil-privacidad.md`): esquema estricto y huella.
 */
const vectores = JSON.parse(
  readFileSync("tests/unit/fixtures/privacidad-vectores.json", "utf8")
) as { perfiles: Record<string, PerfilPrivacidad> };
const dental = vectores.perfiles["dental-co"]!;
const sensible = dental.sensible!;

const rechaza = (perfil: unknown) =>
  !perfilPrivacidadSchema.safeParse(perfil).success;
const conHuella = (perfil: PerfilPrivacidad) => ({
  ...perfil,
  huella: huellaDePerfil(perfil),
});

describe("068 — huella del perfil", () => {
  it("es la misma que calculó el cerebro", () => {
    for (const perfil of Object.values(vectores.perfiles)) {
      expect(huellaDePerfil(perfil)).toBe(perfil.huella);
    }
  });

  it("cubre lo que decide el filtro y nada más", () => {
    const base = huellaDePerfil(dental);
    expect(huellaDePerfil({ ...dental, pais: "MX" })).not.toBe(base);
    expect(
      huellaDePerfil({ ...dental, permitidos: dental.permitidos.slice(1) })
    ).not.toBe(base);
    expect(huellaDePerfil({ ...dental, sensible: null })).not.toBe(base);
    expect(
      huellaDePerfil({
        ...dental,
        perfil: "otro",
        versionPerfil: 9,
      } as PerfilPrivacidad)
    ).toBe(base);
  });

  it("canonicalJson ordena las claves y conserva el orden de las listas", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }], z: undefined })).toBe(
      '{"a":[2,{"c":4,"d":3}],"b":1}'
    );
  });
});

describe("068 — esquema del perfil", () => {
  it("acepta los perfiles exportados por el cerebro", () => {
    for (const perfil of Object.values(vectores.perfiles)) {
      expect(rechaza(perfil)).toBe(false);
    }
  });

  it("rechaza un término cambiado a mano (la huella no cuadra)", () => {
    expect(
      rechaza({ ...dental, sensible: { ...sensible, sintoma: ["otro"] } })
    ).toBe(true);
  });

  it("rechaza una clave de más", () => {
    expect(rechaza({ ...dental, extra: true })).toBe(true);
  });

  it("rechaza un término con mayúsculas o tildes, aunque la huella cuadre", () => {
    for (const termino of ["Dolor", "dolór"]) {
      expect(
        rechaza(
          conHuella({ ...dental, sensible: { ...sensible, sintoma: [termino] } })
        )
      ).toBe(true);
    }
  });

  it("rechaza una categoría de salud desconocida o faltante", () => {
    const otra = {
      ...sensible,
      embarazo: ["embaraz*"],
    } as unknown as PerfilPrivacidad["sensible"];
    expect(rechaza(conHuella({ ...dental, sensible: otra }))).toBe(true);
    const sinUna = Object.fromEntries(
      Object.entries(sensible).filter(([c]) => c !== "medicamento")
    ) as unknown as PerfilPrivacidad["sensible"];
    expect(rechaza(conHuella({ ...dental, sensible: sinUna }))).toBe(true);
  });

  it("rechaza un país inválido y un formato distinto", () => {
    expect(
      rechaza(
        conHuella({ ...dental, pais: "XX" as PerfilPrivacidad["pais"] })
      )
    ).toBe(true);
    expect(rechaza({ ...dental, formato: 2 })).toBe(true);
  });
});
