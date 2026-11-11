import { describe, expect, it } from "vitest";
import {
  MAX_BOTONES,
  MAX_ID_BOTON,
  MAX_TEXTO_CON_BOTONES,
  MAX_TITULO_BOTON,
  bodySchema,
} from "@/server/bot/mensaje-del-bot";

/**
 * 070 (D3) — Los límites de los botones son los de `aliantis-core`
 * (`src/whatsapp/sender.ts`) y la 067 §2: 3 botones, título 20, id 256, texto
 * 1024, ids y títulos únicos. Fuera de eso, 422 `invalid_body`.
 */
const base = {
  conversationId: "cv_1",
  text: "¿Aceptas el aviso de privacidad?",
};
const b = (id: string, title: string) => ({ id, title });
const valido = (body: unknown) => bodySchema.safeParse(body).success;

describe("070 — límites de los botones", () => {
  it("son los de aliantis-core", () => {
    expect([
      MAX_BOTONES,
      MAX_TITULO_BOTON,
      MAX_ID_BOTON,
      MAX_TEXTO_CON_BOTONES,
    ]).toEqual([3, 20, 256, 1024]);
  });

  it("de 1 a 3 botones", () => {
    expect(valido({ ...base, buttons: [b("a", "Acepto")] })).toBe(true);
    expect(
      valido({ ...base, buttons: [b("a", "A"), b("b", "B"), b("c", "C")] }),
    ).toBe(true);
    expect(valido({ ...base, buttons: [] })).toBe(false);
    expect(
      valido({
        ...base,
        buttons: [b("a", "A"), b("b", "B"), b("c", "C"), b("d", "D")],
      }),
    ).toBe(false);
  });

  it("título de 1 a 20 e id de 1 a 256", () => {
    expect(valido({ ...base, buttons: [b("a", "x".repeat(20))] })).toBe(true);
    expect(valido({ ...base, buttons: [b("a", "x".repeat(21))] })).toBe(false);
    expect(valido({ ...base, buttons: [b("a", "")] })).toBe(false);
    expect(valido({ ...base, buttons: [b("x".repeat(256), "A")] })).toBe(true);
    expect(valido({ ...base, buttons: [b("x".repeat(257), "A")] })).toBe(false);
    expect(valido({ ...base, buttons: [b("", "A")] })).toBe(false);
  });

  it("ids y títulos únicos", () => {
    expect(valido({ ...base, buttons: [b("a", "Sí"), b("a", "No")] })).toBe(
      false,
    );
    expect(valido({ ...base, buttons: [b("a", "Sí"), b("b", "Sí")] })).toBe(
      false,
    );
  });

  it("con botones, el texto llega hasta 1024; sin botones, el tope de siempre", () => {
    const largo = "x".repeat(1025);
    expect(
      valido({ ...base, text: "x".repeat(1024), buttons: [b("a", "A")] }),
    ).toBe(true);
    expect(valido({ ...base, text: largo, buttons: [b("a", "A")] })).toBe(
      false,
    );
    expect(valido({ ...base, text: largo })).toBe(true);
  });
});
