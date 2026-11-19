import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROLES } from "@/lib/agent-roles";
import {
  PERSONA_LABELS,
  PERSONAS,
  personaPorClave,
  personasDelPack,
  TODAS_LAS_PERSONAS,
  UNIVERSALES,
} from "@/server/lab/personas";
import { personasDelRol } from "@/server/lab/runner";
import { PACK_IDS, PACKS } from "@/verticals/registro";

/**
 * 072 (A6, D19) — Personas del Laboratorio por nicho: una clínica se prueba
 * con pacientes; `default` conserva exactamente las 8 de siempre.
 */

const keys = (xs: { key: string }[]) => xs.map((p) => p.key);

describe("personas por nicho", () => {
  it("`default` usa las del rol: las 8 de siempre, en su orden", () => {
    const delRol = personasDelRol("calificador");
    expect(keys(personasDelPack("default", delRol))).toEqual([...ROLES.calificador.personas]);
    expect(personasDelPack("default", delRol)).toHaveLength(8);
    expect(personasDelPack("pack-que-no-existe", delRol)).toBe(delRol);
  });

  it("clínica: sus tres pacientes + las cuatro universales", () => {
    expect(keys(personasDelPack("clinica-salud", personasDelRol("calificador")))).toEqual([
      "paciente_valoracion",
      "pregunta_precios_sedes",
      "paciente_molesto_cita",
      ...UNIVERSALES,
    ]);
  });

  it("eventos: novios, corporativo y cumpleaños + universales", () => {
    const ps = personasDelPack("eventos-mobiliario", personasDelRol("calificador"));
    expect(keys(ps).slice(0, 3)).toEqual(["novios_boda", "evento_corporativo", "cumpleanos_ultimo_minuto"]);
    expect(ps).toHaveLength(7);
  });

  it("cada pack con personas propias trae al menos tres", () => {
    for (const id of PACK_IDS) {
      const n = PACKS[id].personas.length;
      expect(n === 0 || n >= 3, id).toBe(true);
    }
  });
});

describe("guardarraíles de las personas", () => {
  it("claves y teléfonos únicos entre TODOS los packs, y sintéticos (570000000…)", () => {
    expect(new Set(keys(TODAS_LAS_PERSONAS)).size).toBe(TODAS_LAS_PERSONAS.length);
    const telefonos = TODAS_LAS_PERSONAS.map((p) => p.phone);
    expect(new Set(telefonos).size).toBe(telefonos.length);
    for (const p of TODAS_LAS_PERSONAS) {
      expect(p.phone, p.key).toMatch(/^570000000\d{3}$/);
      expect(p.contactName.startsWith("[Prueba]"), p.key).toBe(true);
      expect(p.script.length, p.key).toBeGreaterThanOrEqual(3);
    }
  });

  it("los rangos de teléfono son por pack (01xx clínica, 02xx eventos)", () => {
    for (const p of PACKS["clinica-salud"].personas) expect(p.phone).toMatch(/^5700000001\d\d$/);
    for (const p of PACKS["eventos-mobiliario"].personas) expect(p.phone).toMatch(/^5700000002\d\d$/);
  });

  it("toda persona tiene etiqueta y se encuentra por su clave (también las del pack)", () => {
    expect(PERSONA_LABELS.paciente_valoracion).toBe("Paciente que pide valoración");
    expect(personaPorClave("novios_boda")?.phone).toBe("570000000201");
    expect(personaPorClave("hostil")).toBe(PERSONAS.find((p) => p.key === "hostil"));
    expect(personaPorClave("nadie")).toBeUndefined();
  });

  it("la corrida elige por nicho y busca por clave en todas", () => {
    const code = readFileSync(path.resolve(import.meta.dirname, "..", "..", "src", "server", "lab", "runner.ts"), "utf8");
    expect(code).toContain("personasDelPack((await experienciaDe(organizationId)).pack");
    expect(code).toContain("personaPorClave(testCase.persona)");
  });
});
