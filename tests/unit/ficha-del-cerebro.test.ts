import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 078 (T5, D12 de Aliantis) — Lo que el cerebro escribe en la ficha: solo la
 * lista blanca, nunca con una persona atendiendo, solo con la herramienta
 * `ficha`, nunca en el Laboratorio, y un texto que el filtro marca no se guarda.
 */
const h = vi.hoisted(() => ({
  queue: [] as unknown[][],
  politica: null as unknown,
  parches: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "limit"]) builder[m] = () => builder;
  (builder as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve(h.queue.shift() ?? []);
  return { ...actual, getDb: () => builder };
});
vi.mock("@/server/privacy/repositorio", () => ({ perfilDePrivacidad: async () => h.politica }));
vi.mock("@/server/bot/ficha", () => ({
  upsertFicha: async (i: { ficha: Record<string, unknown> }) => {
    h.parches.push(i.ficha);
    return { ficha: { previa: "x", ...i.ficha } };
  },
}));

import {
  escribirFichaDelCerebro,
  validarFichaDelCerebro,
  type FichaDelCerebro,
} from "@/server/bot/ficha-del-cerebro";
import { politicaDesdePerfil, type PerfilPrivacidad } from "@/server/privacy/perfil";

const vectores = JSON.parse(readFileSync("tests/unit/fixtures/privacidad-vectores.json", "utf8")) as {
  perfiles: Record<string, PerfilPrivacidad>;
};
const DENTAL = politicaDesdePerfil(vectores.perfiles["dental-co"]!);

const CONV = { contactId: "ct_1", aiEnabled: true, handoffAt: null, isTest: false };

function base(opts: { conversacion?: object; tools?: string[] | null } = {}) {
  h.queue.push([{ ...CONV, ...(opts.conversacion ?? {}) }], [{ tools: opts.tools ?? null }]);
}
const escribir = (ficha: FichaDelCerebro) =>
  escribirFichaDelCerebro({ organizationId: "org_1", conversationId: "cv_1", ficha });

beforeEach(() => {
  h.queue = [];
  h.parches = [];
  h.politica = DENTAL;
});

describe("078 — la lista blanca", () => {
  it("servicio_interes y quiere_cita; null borra", () => {
    expect(validarFichaDelCerebro({ servicio_interes: "Inglés básico", quiere_cita: true })).toEqual({
      ok: true,
      ficha: { servicio_interes: "Inglés básico", quiere_cita: true },
    });
    expect(validarFichaDelCerebro({ servicio_interes: null })).toMatchObject({ ok: true });
  });

  it("una clave fuera de la lista: clave_no_permitida, con su nombre", () => {
    const r = validarFichaDelCerebro({ quiere_cita: true, sintoma: "dolor" });
    expect(r).toMatchObject({ ok: false, code: "clave_no_permitida" });
    expect(!r.ok && r.message).toContain("sintoma");
  });

  it("un tipo equivocado o un texto largo: invalid_body", () => {
    expect(validarFichaDelCerebro({ quiere_cita: "sí" })).toMatchObject({ code: "invalid_body" });
    expect(validarFichaDelCerebro({ servicio_interes: "x".repeat(81) })).toMatchObject({ code: "invalid_body" });
    expect(validarFichaDelCerebro({ servicio_interes: 7 })).toMatchObject({ code: "invalid_body" });
  });
});

describe("078 — escribir la ficha del cerebro", () => {
  it("escribe el parche y devuelve la ficha completa", async () => {
    base();
    const r = await escribir({ servicio_interes: "Inglés básico", quiere_cita: true });
    expect(r).toEqual({ ok: true, ficha: { previa: "x", servicio_interes: "Inglés básico", quiere_cita: true } });
  });

  it("Laboratorio: prueba, sin escribir", async () => {
    h.queue.push([{ ...CONV, isTest: true }]);
    expect(await escribir({ quiere_cita: true })).toEqual({ ok: true, prueba: true });
    expect(h.parches).toEqual([]);
  });

  it("con una persona atendiendo: 409 ai_paused, sin escribir", async () => {
    base({ conversacion: { handoffAt: new Date() } });
    expect(await escribir({ quiere_cita: true })).toMatchObject({ ok: false, status: 409, code: "ai_paused" });
    base({ conversacion: { aiEnabled: false } });
    expect(await escribir({ quiere_cita: true })).toMatchObject({ code: "ai_paused" });
    expect(h.parches).toEqual([]);
  });

  it("con la herramienta ficha apagada: 409", async () => {
    base({ tools: ["etapa"] });
    expect(await escribir({ quiere_cita: true })).toMatchObject({ code: "herramienta_apagada" });
    expect(h.parches).toEqual([]);
  });

  it("un texto con salud no se guarda (ni el marcador); lo demás sí", async () => {
    base();
    await escribir({ servicio_interes: "me duele la muela", quiere_cita: true });
    expect(h.parches).toEqual([{ quiere_cita: true }]);
  });

  it("sin perfil legible, el texto no se guarda", async () => {
    h.politica = null;
    base();
    await escribir({ servicio_interes: "Inglés básico" });
    expect(h.parches).toEqual([{}]);
  });

  it("sin conversación: 404", async () => {
    h.queue.push([]);
    expect(await escribir({ quiere_cita: true })).toMatchObject({ status: 404 });
  });
});
