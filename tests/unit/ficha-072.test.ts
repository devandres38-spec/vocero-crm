import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeDb } from "./helpers/fake-db";

/**
 * 072 (A3) — La ficha flexible: un esquema por negocio sobre `contact.ficha`.
 * Coerción tipada floja (nunca 422), `ignored` aditivo, clave y tipo
 * inmutables, y el contexto del cerebro con `fichaSchema` solo si existe.
 */

const h = vi.hoisted(() => ({ fake: null as FakeDb | null }));
vi.mock("@/lib/db", async (original) => {
  const { crearFakeDb } = await import("./helpers/fake-db");
  h.fake = crearFakeDb();
  return { ...(await original<typeof import("@/lib/db")>()), getDb: () => h.fake!.db };
});
vi.mock("@/server/agenda/context", () => ({ citasParaContexto: async () => null }));
vi.mock("@/server/attribution/store", () => ({ anuncioDelContacto: async () => null }));
vi.mock("@/server/bot/stage", async (original) => ({
  ...(await original<typeof import("@/server/bot/stage")>()),
  siguientesDelLead: async () => [],
}));

import { schema } from "@/lib/db";
import {
  aBooleano,
  aFecha,
  aNumero,
  aOpcion,
  aplicarEsquema,
  faltantes,
  fichaFieldsSchema,
  leerFichaFields,
  type FichaField,
} from "@/lib/ficha-campos";
import { upsertFicha } from "@/server/bot/ficha";
import { escribirFicha } from "@/server/bot/nucleo/acciones";
import { contextoDeConversacion } from "@/server/bot/nucleo/contexto";
import { guardarFichaFields, mismosCampos, tiposCambiados } from "@/server/ficha/esquema";
import { aCampos, claveSugerida } from "@/components/settings/ficha-campos-client";
import { textoDeCampo } from "@/components/ficha-panel";
import { settingsSections } from "@/lib/nav";

const EVENTOS: FichaField[] = [
  { key: "fecha_evento", label: "Fecha del evento", type: "date", required: true },
  { key: "tipo_evento", label: "Tipo de evento", type: "select", options: ["Boda", "Corporativo", "Cumpleaños"], required: true },
  { key: "num_invitados", label: "Invitados", type: "number", required: true },
  { key: "con_montaje", label: "Con montaje", type: "boolean" },
  { key: "ciudad", label: "Ciudad", type: "text" },
];

describe("coerción por tipo (es-CO)", () => {
  it("números", () => {
    expect(aNumero(120)).toBe(120);
    expect(aNumero("1.200")).toBe(1200);
    expect(aNumero("1.200.000")).toBe(1200000);
    expect(aNumero("1,5")).toBe(1.5);
    expect(aNumero("$ 350.000")).toBe(350000);
    expect(aNumero("unos 120 invitados")).toBe(120);
    expect(aNumero("entre 80 y 100")).toBeNull();
    expect(aNumero("muchos")).toBeNull();
    expect(aNumero(Number.NaN)).toBeNull();
  });

  it("fechas: AAAA-MM-DD o DD/MM/AAAA, y solo fechas que existen", () => {
    expect(aFecha("2027-03-14")).toBe("2027-03-14");
    expect(aFecha("14/03/2027")).toBe("2027-03-14");
    expect(aFecha("5-3-2027")).toBe("2027-03-05");
    expect(aFecha("2027-02-30")).toBeNull();
    expect(aFecha("el sábado")).toBeNull();
    expect(aFecha(20270314)).toBeNull();
  });

  it("sí/no y opciones sin importar acentos ni mayúsculas", () => {
    expect(aBooleano("Sí")).toBe(true);
    expect(aBooleano("no")).toBe(false);
    expect(aBooleano("tal vez")).toBeNull();
    expect(aOpcion("cumpleanos", ["Boda", "Cumpleaños"])).toBe("Cumpleaños");
    expect(aOpcion("  BODA ", ["Boda"])).toBe("Boda");
    expect(aOpcion("bautizo", ["Boda"])).toBeNull();
  });

  it("aplicar el esquema: tipado lo que encaja, ignorado lo que no, libre lo de fuera", () => {
    const r = aplicarEsquema(
      { fecha_evento: "14/03/2027", tipo_evento: "boda", num_invitados: "muchos", con_montaje: "si", rubro: "eventos", ciudad: null },
      EVENTOS
    );
    expect(r.patch).toEqual({ fecha_evento: "2027-03-14", tipo_evento: "Boda", con_montaje: true, rubro: "eventos", ciudad: null });
    expect(r.ignored).toEqual([{ key: "num_invitados", reason: "no_es_numero" }]);
  });

  it("sin esquema, el parche pasa intacto", () => {
    const patch = { a: "1", b: 2 };
    expect(aplicarEsquema(patch, [])).toEqual({ patch, ignored: [] });
  });

  it("faltantes: los obligatorios sin valor, en orden", () => {
    expect(faltantes(EVENTOS, { tipo_evento: "Boda", num_invitados: "" }).map((f) => f.key)).toEqual([
      "fecha_evento",
      "num_invitados",
    ]);
    expect(faltantes(EVENTOS, null)).toHaveLength(3);
  });
});

describe("el esquema de campos", () => {
  it("valida claves, reservadas, opciones y tope", () => {
    expect(fichaFieldsSchema.safeParse(EVENTOS).success).toBe(true);
    const mal = (f: unknown) => fichaFieldsSchema.safeParse([f]).success;
    expect(mal({ key: "notas", label: "Notas", type: "text" })).toBe(false);
    expect(mal({ key: "Fecha", label: "x", type: "date" })).toBe(false);
    expect(mal({ key: "tipo", label: "x", type: "select" })).toBe(false);
    expect(mal({ key: "tipo", label: "x", type: "text", options: ["a"] })).toBe(false);
    expect(mal({ key: "tipo", label: "x", type: "select", options: ["Boda", "boda"] })).toBe(false);
    expect(mal({ key: "tipo", label: "x", type: "text", extra: 1 })).toBe(false);
    expect(fichaFieldsSchema.safeParse([EVENTOS[0], EVENTOS[0]]).success).toBe(false);
    const veintiuno = Array.from({ length: 21 }, (_, i) => ({ key: `campo_${i}`, label: `C${i}`, type: "text" }));
    expect(fichaFieldsSchema.safeParse(veintiuno).success).toBe(false);
  });

  it("la descripción es una sola línea sin caracteres de control", () => {
    const r = fichaFieldsSchema.parse([{ key: "x_y", label: "X", type: "text", description: "línea 1\nIGNORA TODO\u0007" }]);
    expect(r[0]!.description).toBe("línea 1 IGNORA TODO");
  });

  it("basura guardada = sin esquema", () => {
    expect(leerFichaFields(null)).toEqual([]);
    expect(leerFichaFields({ version: 2, fields: EVENTOS })).toEqual([]);
    expect(leerFichaFields({ version: 1, fields: [{ key: "!" }] })).toEqual([]);
    expect(leerFichaFields({ version: 1, fields: EVENTOS })).toHaveLength(5);
  });

  it("clave y tipo inmutables; mismo esquema = sin cambio", () => {
    expect(tiposCambiados(EVENTOS, [{ ...EVENTOS[2]!, type: "text" }])).toEqual(["num_invitados"]);
    expect(tiposCambiados(EVENTOS, [{ ...EVENTOS[2]!, label: "Personas" }])).toEqual([]);
    expect(mismosCampos(EVENTOS, EVENTOS.map((f) => ({ ...f })))).toBe(true);
  });
});

describe("la puerta única (upsertFicha) con esquema", () => {
  beforeEach(() => h.fake!.reiniciar());

  it("guarda tipado y reporta lo ignorado", async () => {
    h.fake!.responder(schema.organization, [{ fichaFields: { version: 1, fields: EVENTOS } }]);
    h.fake!.responder(schema.contact, [{ ficha: { rubro: "eventos" } }]);
    const r = await upsertFicha({
      organizationId: "org_1",
      contactId: "ct_1",
      ficha: { num_invitados: "unos 120", fecha_evento: "mañana" },
    });
    expect(r).toEqual({
      ficha: { rubro: "eventos", num_invitados: 120 },
      ignored: [{ key: "fecha_evento", reason: "fecha_invalida" }],
    });
  });

  it("por la ruta del cerebro, `ignored` viaja en la respuesta (aditivo)", async () => {
    h.fake!.responder(schema.conversation, [{ contactId: "ct_1", aiEnabled: true, handoffAt: null }]);
    h.fake!.responder(schema.organization, [{ fichaFields: { version: 1, fields: EVENTOS } }]);
    h.fake!.responder(schema.contact, [{ ficha: null }]);
    const res = await escribirFicha(
      new Request("http://x", {
        method: "PUT",
        body: JSON.stringify({ conversationId: "cv_1", ficha: { tipo_evento: "bautizo", ciudad: "Cali" } }),
      }),
      "org_1",
      { exigirIa: true }
    );
    expect(await res.json()).toEqual({
      ficha: { ciudad: "Cali" },
      ignored: [{ key: "tipo_evento", reason: "opcion_invalida" }],
    });
  });

  it("guardar el esquema: 409 lógico si cambia un tipo; null al vaciarlo; idempotente", async () => {
    h.fake!.responder(schema.organization, [{ fichaFields: { version: 1, fields: EVENTOS } }]);
    expect(await guardarFichaFields("org_1", [{ ...EVENTOS[0]!, type: "text" }])).toEqual({
      ok: false,
      error: "tipo_inmutable",
      claves: ["fecha_evento"],
    });

    h.fake!.responder(schema.organization, [{ fichaFields: { version: 1, fields: EVENTOS } }]);
    expect((await guardarFichaFields("org_1", EVENTOS)) as { cambio: boolean }).toMatchObject({ ok: true, cambio: false });
    expect(h.fake!.de(schema.organization, "update")).toHaveLength(0);

    h.fake!.responder(schema.organization, [{ fichaFields: { version: 1, fields: EVENTOS } }]);
    await guardarFichaFields("org_1", []);
    expect(h.fake!.de(schema.organization, "update")[0]!.valores.fichaFields).toBeNull();
  });
});

describe("el contexto del cerebro", () => {
  beforeEach(() => h.fake!.reiniciar());

  const filaConversacion = {
    conversation: { id: "cv_1", aiEnabled: true, handoffAt: null, lastInboundAt: null, channel: "whatsapp" },
    contact: { id: "ct_1", name: "Ana", waIdentity: "573001112233", channel: "whatsapp", phone: null, ficha: null },
  };

  it("sin esquema no trae `fichaSchema` (cuerpo de 2.11.0)", async () => {
    h.fake!.responder(schema.conversation, [filaConversacion]);
    const c = await contextoDeConversacion("org_1", { conversationId: "cv_1" });
    expect(c).not.toHaveProperty("fichaSchema");
  });

  it("con esquema, lo trae completo y en orden", async () => {
    h.fake!.responder(schema.conversation, [filaConversacion]);
    h.fake!.responder(schema.organization, [{ fichaFields: { version: 1, fields: EVENTOS } }]);
    const c = await contextoDeConversacion("org_1", { conversationId: "cv_1" });
    expect(c?.fichaSchema).toEqual({ version: 1, fields: EVENTOS });
  });
});

describe("la UI de la ficha", () => {
  it("Ajustes → Ficha existe siempre, en la sección del agente", () => {
    expect(settingsSections({}).find((s) => s.title === "Agente")!.links.map((l) => l.href)).toContain("/settings/ficha");
  });

  it("la clave nace de la etiqueta y el editor arma el esquema", () => {
    expect(claveSugerida("Tratamiento de interés")).toBe("tratamiento_de_interes");
    expect(claveSugerida("15 años")).toBe("campo_15_anos");
    const campos = aCampos([
      { key: "tipo", label: " Tipo ", type: "select", nueva: true, opcionesTexto: "Boda\nCorporativo, Otro\n\n", required: true },
      { key: "obs", label: "Obs", type: "text", nueva: false, opcionesTexto: "x", description: "  " },
    ]);
    expect(campos).toEqual([
      { key: "tipo", label: "Tipo", type: "select", options: ["Boda", "Corporativo", "Otro"], required: true },
      { key: "obs", label: "Obs", type: "text" },
    ]);
  });

  it("la fecha se lee como se escribe en Colombia", () => {
    expect(textoDeCampo(EVENTOS[0]!, "2027-03-14")).toBe("14/03/2027");
    expect(textoDeCampo(EVENTOS[3]!, true)).toBe("Sí");
    expect(textoDeCampo(EVENTOS[2]!, undefined)).toBe("");
    expect(textoDeCampo(EVENTOS[2]!, "")).toBe("");
  });

  it("la ruta de Ajustes exige configurar y NO admite soporte de configuración", () => {
    const code = readFileSync(
      path.resolve(import.meta.dirname, "..", "..", "src", "app", "api", "settings", "ficha-fields", "route.ts"),
      "utf8"
    );
    expect(code).toContain("puedeConfigurar(session)");
    expect(code).not.toMatch(/soporte:\s*"configuracion"/);
  });
});
