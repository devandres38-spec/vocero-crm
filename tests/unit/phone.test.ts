import { describe, expect, it } from "vitest";
import { normalizarTelefonoHumano, paisDeTelefono } from "@/lib/phone";

/** 068 — Teléfonos escritos por una persona, con Colombia como país por defecto. */
const n = (raw: string, pais = "CO") => normalizarTelefonoHumano(raw, pais);
const ok = (phone: string) => ({ ok: true, phone });

describe("normalizarTelefonoHumano", () => {
  it("un celular colombiano local, con o sin formato", () => {
    expect(n("3001234567")).toEqual(ok("573001234567"));
    expect(n("300 123 4567")).toEqual(ok("573001234567"));
    expect(n("300-123-4567")).toEqual(ok("573001234567"));
  });

  it("un fijo colombiano de 10 dígitos (60X)", () => {
    expect(n("(604) 444 5566")).toEqual(ok("576044445566"));
  });

  it("el mismo número con código de país, con +, con 00 o sin nada", () => {
    expect(n("+57 300 123 4567")).toEqual(ok("573001234567"));
    expect(n("0057 300 123 4567")).toEqual(ok("573001234567"));
    expect(n("573001234567")).toEqual(ok("573001234567"));
  });

  it("México sigue canonizando 521 → 52 (misma identidad que la ingesta)", () => {
    expect(n("+52 1 55 1234 5678")).toEqual(ok("525512345678"));
    expect(n("5215512345678")).toEqual(ok("525512345678"));
    expect(n("525512345678")).toEqual(ok("525512345678"));
  });

  it("un número de otro país con su código no se lee como colombiano", () => {
    expect(n("+1 415 555 2671")).toEqual(ok("14155552671"));
    expect(n("14155552671")).toEqual(ok("14155552671"));
  });

  it("un local que no es válido en Colombia no recibe un 57 inventado", () => {
    expect(n("5512345678")).toEqual({ ok: false, reason: "sin_codigo_pais" });
    expect(n("12345")).toEqual({ ok: false, reason: "sin_codigo_pais" });
  });

  it("vacío, demasiado largo o imposible", () => {
    expect(n("")).toEqual({ ok: false, reason: "sin_telefono" });
    expect(n("   ")).toEqual({ ok: false, reason: "sin_telefono" });
    expect(n("1234567890123456")).toEqual({ ok: false, reason: "telefono_invalido" });
    expect(n("+57 12")).toEqual({ ok: false, reason: "telefono_invalido" });
  });

  it("el país por defecto es un parámetro, no una constante", () => {
    expect(n("55 1234 5678", "MX")).toEqual(ok("525512345678"));
  });
});

describe("paisDeTelefono", () => {
  it("dice el código y el nombre del país de la región", () => {
    expect(paisDeTelefono("CO", "es-CO")).toEqual({ codigo: "57", nombre: "Colombia" });
  });

  it("un país desconocido no rompe nada", () => {
    expect(paisDeTelefono("ZZ", "es-CO").codigo).toBe("");
  });
});
