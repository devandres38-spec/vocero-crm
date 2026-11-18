import { describe, expect, it } from "vitest";
import {
  modulosEfectivos,
  modulosOrganizacionSchema,
  type TechoInstancia,
} from "@/server/modulos/efectivos";

const techoTodo: TechoInstancia = {
  agenda: true,
  atribucion: true,
  channels: new Set(["whatsapp", "instagram", "messenger"]),
};
const techoMinimo: TechoInstancia = {
  agenda: false,
  atribucion: false,
  channels: new Set(["whatsapp"]),
};

describe("069 — módulos efectivos = techo ∧ organización", () => {
  it("sin módulos guardados hereda el techo (comportamiento 2.8.0)", () => {
    expect(modulosEfectivos(techoTodo, null)).toEqual({
      agenda: true,
      atribucion: true,
      channels: ["whatsapp", "instagram", "messenger"],
      modules: [],
    });
    expect(modulosEfectivos(techoMinimo, {})).toEqual({
      agenda: false,
      atribucion: false,
      channels: ["whatsapp"],
      modules: [],
    });
  });

  it("la organización apaga dentro del techo", () => {
    const m = modulosEfectivos(techoTodo, { agenda: false, channels: ["whatsapp", "instagram"] });
    expect(m.agenda).toBe(false);
    expect(m.atribucion).toBe(true);
    expect(m.channels).toEqual(["whatsapp", "instagram"]);
  });

  it("el techo gana: la organización no enciende lo que la instancia no tiene", () => {
    const m = modulosEfectivos(techoMinimo, { agenda: true, channels: ["whatsapp", "instagram"] });
    expect(m.agenda).toBe(false);
    expect(m.channels).toEqual(["whatsapp"]);
  });

  it("WhatsApp siempre, aunque la organización lo omita", () => {
    expect(modulosEfectivos(techoTodo, { channels: [] }).channels).toEqual(["whatsapp"]);
  });

  it("basura en la columna se trata como heredar", () => {
    expect(modulosEfectivos(techoTodo, "x").agenda).toBe(true);
    expect(modulosEfectivos(techoTodo, { agenda: "no" }).agenda).toBe(true);
  });

  it("los verticales desconocidos no se cuelan (el catálogo nace vacío)", () => {
    expect(modulosEfectivos(techoTodo, { modules: ["clinica"] }).modules).toEqual([]);
  });
});

describe("069 — validación de lo que guarda la agencia", () => {
  it("acepta un objeto válido", () => {
    expect(
      modulosOrganizacionSchema.safeParse({ agenda: true, channels: ["whatsapp", "instagram"] }).success
    ).toBe(true);
  });

  it.each([
    [{ channels: ["instagram"] }, "whatsapp_obligatorio"],
    [{ channels: ["whatsapp", "fax"] }, "canal_desconocido"],
    [{ modules: ["clinica"] }, "modulo_desconocido"],
  ])("rechaza %j (%s)", (valor, motivo) => {
    const r = modulosOrganizacionSchema.safeParse(valor);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain(motivo);
  });

  it("rechaza claves desconocidas", () => {
    expect(modulosOrganizacionSchema.safeParse({ billing: true }).success).toBe(false);
  });
});
