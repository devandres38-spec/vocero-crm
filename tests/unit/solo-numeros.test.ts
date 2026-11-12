import { describe, expect, it } from "vitest";
import { LISTA_APAGADA, permitidoPorLista } from "@/server/dispatch/solo-numeros";

/** 079 (T4) — La regla de «Solo estos números». */
const lista = (numeros: string[]) => ({ activo: true, numeros });

describe("079 — permitidoPorLista", () => {
  it("apagada: todo pasa, incluso Instagram, bsuid o sin identidad", () => {
    for (const id of ["573001112233", "ig:123", "bsuid:CO.abc", "fb:9", "tt:1", null, undefined]) {
      expect(permitidoPorLista(LISTA_APAGADA, id)).toBe(true);
    }
    // Apagada con números guardados: igual pasa todo.
    expect(permitidoPorLista({ activo: false, numeros: ["573001112233"] }, "ig:1")).toBe(true);
  });

  it("encendida: pasa el número de la lista, no otro", () => {
    const l = lista(["573001112233", "5215512345678"]);
    expect(permitidoPorLista(l, "573001112233")).toBe(true);
    expect(permitidoPorLista(l, "573009998877")).toBe(false);
  });

  it("521… y 52… son el mismo número de México, en los dos sentidos", () => {
    expect(permitidoPorLista(lista(["525512345678"]), "5215512345678")).toBe(true);
    expect(permitidoPorLista(lista(["5215512345678"]), "525512345678")).toBe(true);
  });

  it("encendida: ig:, fb:, tt: y bsuid: no pasan aunque el resto coincida", () => {
    const l = lista(["573001112233"]);
    for (const id of ["ig:573001112233", "fb:573001112233", "tt:573001112233", "bsuid:573001112233"]) {
      expect(permitidoPorLista(l, id)).toBe(false);
    }
  });

  it("encendida: sin identidad o vacía, no pasa", () => {
    const l = lista(["573001112233"]);
    expect(permitidoPorLista(l, null)).toBe(false);
    expect(permitidoPorLista(l, "")).toBe(false);
    expect(permitidoPorLista(lista([]), "573001112233")).toBe(false);
  });
});
