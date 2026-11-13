import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  politicaDesdePerfil,
  type PerfilPrivacidad,
} from "@/server/privacy/perfil";
import { classifyAndMask } from "@/server/privacy/privacy-filter";
import {
  NEAR_HEALTH,
  OTHER_BUSINESSES,
  WITH_HEALTH,
  WITH_HEALTH_TYPOS,
  WITHOUT_HEALTH,
} from "./fixtures/privacy-corpus";

/**
 * 068 — Las metas del filtro de salud de aliantis-core, medidas en Vocero:
 * detectar el 100 % de los mensajes con salud y marcar por error como máximo
 * el 5 % de los que no tienen.
 *
 * `fixtures/privacy-corpus.ts` es copia byte a byte de
 * `aliantis-brain/test/fixtures/privacy-corpus.ts`. Para que no se quede
 * atrás, cada caso del corpus debe estar en los vectores gemelos.
 */
const vectores = JSON.parse(
  readFileSync("tests/unit/fixtures/privacidad-vectores.json", "utf8")
) as {
  perfiles: Record<string, PerfilPrivacidad>;
  casos: { perfil: string | null; texto: string }[];
};

function politica(clave: string) {
  const perfil = vectores.perfiles[clave];
  if (!perfil) throw new Error(`Falta el perfil ${clave} en los vectores`);
  return politicaDesdePerfil(perfil);
}

const dental = politica("dental-co");
const generico = politica("generico-co");
const conSalud = (texto: string, p = dental) =>
  classifyAndMask(texto, p).health !== null;

describe("068 — corpus del filtro de salud", () => {
  it("el corpus es el mismo que llevan los vectores gemelos", () => {
    const enVectores = (perfil: string) =>
      new Set(
        vectores.casos.filter((c) => c.perfil === perfil).map((c) => c.texto)
      );
    const dentalCo = enVectores("dental-co");
    const genericoCo = enVectores("generico-co");
    expect(
      [...WITH_HEALTH, ...WITHOUT_HEALTH].filter((t) => !dentalCo.has(t))
    ).toEqual([]);
    expect(OTHER_BUSINESSES.filter((t) => !genericoCo.has(t))).toEqual([]);
    expect(WITH_HEALTH_TYPOS.filter((t) => !dentalCo.has(t))).toEqual([]);
    expect(
      NEAR_HEALTH.filter((t) => !dentalCo.has(t) || !genericoCo.has(t))
    ).toEqual([]);
  });

  it("detecta el 100 % de los mensajes con datos de salud", () => {
    expect(WITH_HEALTH.filter((t) => !conSalud(t))).toEqual([]);
  });

  it("marca por error como máximo el 5 % de los mensajes sin datos de salud", () => {
    const marcados = WITHOUT_HEALTH.filter((t) => conSalud(t));
    expect(marcados.length / WITHOUT_HEALTH.length).toBeLessThanOrEqual(0.05);
  });

  it("con la lista general, otros negocios casi no derivan por salud", () => {
    const marcados = OTHER_BUSINESSES.filter((t) => conSalud(t, generico));
    expect(marcados.length / OTHER_BUSINESSES.length).toBeLessThanOrEqual(0.05);
  });
});

/** 081 — Errores de escritura (spec 016 del cerebro): lo que se tolera no tapa palabras normales. */
describe("081 — errores de escritura", () => {
  it("detecta el 100 % de los mensajes de salud mal escritos", () => {
    expect(WITH_HEALTH_TYPOS.filter((t) => !conSalud(t))).toEqual([]);
  });

  it("ninguna palabra vecina deriva, ni con el perfil dental ni con el genérico", () => {
    expect(
      NEAR_HEALTH.filter((t) => conSalud(t) || conSalud(t, generico))
    ).toEqual([]);
  });
});
