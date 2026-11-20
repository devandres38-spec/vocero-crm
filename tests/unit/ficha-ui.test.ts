import { describe, expect, it } from "vitest";
import {
  fichaEntries,
  fichaLabel,
  fichaValueText,
  parseFichaValue,
} from "@/lib/ficha";

describe("fichaLabel", () => {
  it("lee bonito lo que escribió un LLM, en cualquiera de sus manías", () => {
    expect(fichaLabel("dolor_principal")).toBe("Dolor principal");
    expect(fichaLabel("dolorPrincipal")).toBe("Dolor principal");
    expect(fichaLabel("dolor-principal")).toBe("Dolor principal");
    expect(fichaLabel("presupuesto")).toBe("Presupuesto");
  });

  it("no se rompe con claves raras", () => {
    expect(fichaLabel("m2")).toBe("M2");
    expect(fichaLabel("__")).toBe("__");
    expect(fichaLabel("ZONA")).toBe("Zona");
  });
});

describe("fichaValueText", () => {
  it("los booleanos se leen Sí/No: nadie califica en true", () => {
    expect(fichaValueText(true)).toBe("Sí");
    expect(fichaValueText(false)).toBe("No");
  });

  it("números y textos pasan tal cual", () => {
    expect(fichaValueText(50000)).toBe("50000");
    expect(fichaValueText("Polanco")).toBe("Polanco");
  });
});

describe("parseFichaValue", () => {
  it("editar NO cambia el tipo del dato", () => {
    // Del otro lado hay un bot que puede estar comparando; convertir en
    // silencio un número a texto es de los cambios que solo se descubren
    // cuando algo ya falló.
    expect(parseFichaValue("60000", 50000)).toBe(60000);
    expect(parseFichaValue("No", true)).toBe(false);
    expect(parseFichaValue("sí", false)).toBe(true);
    expect(parseFichaValue("Polanco", "Roma")).toBe("Polanco");
  });

  it("pero sí lo cambia si lo escrito ya no es de ese tipo", () => {
    expect(parseFichaValue("como cinco mil", 5000)).toBe("como cinco mil");
    expect(parseFichaValue("depende", true)).toBe("depende");
  });

  it("2.13.1 — lee los montos en COP (el punto es de miles)", () => {
    // Antes `Number("600.000")` daba 600: el presupuesto quedaba mil veces
    // más chico sin que nadie lo notara.
    expect(parseFichaValue("600.000", 500000)).toBe(600000);
    expect(parseFichaValue("$ 1.250.000", 0)).toBe(1250000);
    expect(parseFichaValue("1.250.000,50", 0)).toBe(1250000.5);
    expect(parseFichaValue("2,5", 1)).toBe(2.5);
    expect(parseFichaValue("0.125", 1)).toBe(0.125);
    expect(parseFichaValue("", 5000)).toBe("");
  });

  it("un dato nuevo entra como texto", () => {
    expect(parseFichaValue("42", undefined)).toBe("42");
  });

  it("recorta los espacios de sobra", () => {
    expect(parseFichaValue("  Polanco  ", "Roma")).toBe("Polanco");
  });
});

describe("fichaEntries", () => {
  it("ordena para que la ficha no baile entre recargas", () => {
    const claves = fichaEntries({ zona: "Roma", dolor: "x", presupuesto: 1 }).map(
      ([k]) => k
    );
    expect(claves).toEqual(["dolor", "presupuesto", "zona"]);
  });

  it("una ficha vacía no truena", () => {
    expect(fichaEntries({})).toEqual([]);
  });
});
