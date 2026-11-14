import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildJudgePrompt } from "@/server/ai/prompts";
import { llaveDelGasto } from "@/server/panel/gasto";
import {
  llaveDelLab,
  pedirNegocioDelLab,
  renderNegocio,
  type NegocioDelLab,
} from "@/server/lab/negocio";
import {
  guionDe,
  PERSONAS,
  personasParaNegocio,
  serviciosDelGuion,
  type Persona,
} from "@/server/lab/personas";
import {
  BOTON_ACEPTO,
  BOTON_NO_ACEPTO,
  esContactoDelLaboratorio,
  respuestaAlAviso,
} from "@/server/lab/runner";

/** 083 (bloque P2) — El Laboratorio por negocio: guiones, aviso, consentimiento limpio y juez. */

const ACADEMIA: NegocioDelLab = {
  organizationId: "org_a",
  negocio: "Academia Futuro",
  tono: "tu",
  filtroSalud: true,
  servicios: [
    { nombre: "Inglés básico", precio: "$450.000", precioDesde: false, duracion: null },
    { nombre: "Curso de Excel", precio: "$300.000", precioDesde: false, duracion: "8 horas" },
    { nombre: "Programación web", precio: null, precioDesde: false, duracion: null },
  ],
  horario: "de lunes a jueves de 8:00 a. m. a 8:00 p. m.",
  direccion: "Carrera 7 # 40-10, piso 2, Medellín",
  mediosPago: ["efectivo", "transferencia"],
  preguntasFrecuentes: [{ pregunta: "¿Dan certificado?", respuesta: "Sí, al terminar." }],
};

const persona = (key: string): Persona => PERSONAS.find((p) => p.key === key)!;
const FERRETERIA = /taladr|martill|pintura|clavo|lijadora|desarmador|tiner/i;

describe("083 · guiones por negocio (D2)", () => {
  it("CA-1 con el catálogo de la academia: sus cursos, nada de ferretería", () => {
    for (const p of PERSONAS) {
      for (const linea of guionDe(p, ACADEMIA)) {
        expect(linea, p.key).not.toMatch(FERRETERIA);
        expect(linea, p.key).not.toMatch(/\{[a-z0-9_]+\}/);
      }
    }
    expect(guionDe(persona("comprador_decidido"), ACADEMIA)).toContain(
      "¿Cuánto cuesta Inglés básico?"
    );
    expect(guionDe(persona("errores_modismos"), ACADEMIA)).toContain("cuanto bale inglés básico?");
  });

  it("s1 y s2 tienen precio; s3 es el que no lo tiene (responde una persona)", () => {
    expect(serviciosDelGuion(ACADEMIA)).toEqual({
      s1: "Inglés básico",
      s2: "Curso de Excel",
      s3: "Programación web",
    });
  });

  it("con un solo servicio, los huecos no quedan vacíos", () => {
    const uno = { ...ACADEMIA, servicios: [ACADEMIA.servicios[0]!] };
    expect(serviciosDelGuion(uno)).toEqual({
      s1: "Inglés básico",
      s2: "Inglés básico",
      s3: "Inglés básico",
    });
  });

  it("CA-2 sin catálogo: frases neutras, sin un solo hueco ni ferretería", () => {
    for (const p of PERSONAS) {
      for (const linea of guionDe(p, null)) {
        expect(linea, p.key).not.toMatch(/\{[a-z0-9_]+\}/);
        expect(linea, p.key).not.toMatch(FERRETERIA);
      }
    }
    expect(guionDe(persona("pregunton_precios"), null)[0]).toBe(
      "Hola, ¿cuánto vale su servicio más pedido?"
    );
  });

  it("la persona de salud solo va con filtro de salud", () => {
    const keys = (n: NegocioDelLab | null) => personasParaNegocio(PERSONAS, n).map((p) => p.key);
    expect(keys(ACADEMIA)).toContain("salud");
    expect(keys({ ...ACADEMIA, filtroSalud: false })).not.toContain("salud");
    expect(keys(null)).not.toContain("salud");
  });

  it("los teléfonos de las personas son únicos y sintéticos", () => {
    const telefonos = PERSONAS.map((p) => p.phone);
    expect(new Set(telefonos).size).toBe(telefonos.length);
    expect(telefonos.every((t) => /^52100000000\d\d$/.test(t))).toBe(true);
  });
});

describe("083 · el cliente simulado ante el aviso (D3)", () => {
  const aviso = {
    buttons: [
      { id: BOTON_ACEPTO, title: "Acepto" },
      { id: BOTON_NO_ACEPTO, title: "No acepto" },
    ],
  };

  it("CA-3 acepta con el botón Acepto, rechaza con No acepto, ignora sigue su guion", () => {
    expect(respuestaAlAviso({ alAviso: "acepta" }, aviso)).toEqual({
      text: "Acepto",
      buttonId: BOTON_ACEPTO,
    });
    expect(respuestaAlAviso({ alAviso: "rechaza" }, aviso)).toEqual({
      text: "No acepto",
      buttonId: BOTON_NO_ACEPTO,
    });
    expect(respuestaAlAviso({ alAviso: "ignora" }, aviso)).toBeNull();
    expect(respuestaAlAviso({}, aviso)).toBeNull();
  });

  it("sin aviso (otro saliente, o sin botones) no responde nada", () => {
    expect(respuestaAlAviso({ alAviso: "acepta" }, { buttons: null })).toBeNull();
    expect(respuestaAlAviso({ alAviso: "acepta" }, undefined)).toBeNull();
    expect(
      respuestaAlAviso({ alAviso: "acepta" }, { buttons: [{ id: "otro:si", title: "Sí" }] })
    ).toBeNull();
  });

  it("las personas del consentimiento dicen qué hacen ante el aviso", () => {
    expect(persona("comprador_decidido").alAviso).toBe("acepta");
    expect(persona("agenda_rechaza").alAviso).toBe("rechaza");
    expect(persona("agenda_ignora").alAviso).toBe("ignora");
    expect(persona("deja_datos").alAviso).toBe("acepta");
  });
});

describe("083 · consentimiento limpio solo en contactos del Laboratorio (D5)", () => {
  const archivado = new Date("2026-11-13T10:00:00Z");

  it("CA-5 un contacto sintético archivado del Laboratorio: sí", () => {
    expect(esContactoDelLaboratorio({ phone: "5210000000001", archivedAt: archivado })).toBe(true);
  });

  it.each([
    ["un teléfono real", { phone: "573001112233", archivedAt: archivado }],
    ["sin archivar", { phone: "5210000000001", archivedAt: null }],
    ["sin teléfono", { phone: null, archivedAt: archivado }],
  ])("CA-5 %s: nunca", (_nombre, contacto) => {
    expect(esContactoDelLaboratorio(contacto)).toBe(false);
  });
});

describe("083 · el negocio que tiene el cerebro (D1)", () => {
  const ENV = { BRAIN_DISPATCH_URL: "https://cerebro.ejemplo/vocero/dispatch", BOT_API_KEY: "llave-de-prueba" };
  const AHORA = Date.parse("2026-11-13T15:00:00Z");

  it("firma con su llave derivada propia (no la del gasto) y lee el negocio", async () => {
    let pedido: { url: string; firma: string; cuerpo: string } | undefined;
    const fetchFalso = (async (url: string, init: RequestInit) => {
      pedido = {
        url,
        firma: (init.headers as Record<string, string>)["X-Vocero-Signature"]!,
        cuerpo: String(init.body),
      };
      return new Response(JSON.stringify(ACADEMIA), { status: 200 });
    }) as unknown as typeof fetch;

    const negocio = await pedirNegocioDelLab("org_a", { env: ENV, fetch: fetchFalso, ahora: () => AHORA });

    expect(negocio).toEqual(ACADEMIA);
    expect(pedido!.url).toBe("https://cerebro.ejemplo/vocero/lab/negocio");
    expect(JSON.parse(pedido!.cuerpo)).toEqual({ en: new Date(AHORA).toISOString(), organizationId: "org_a" });
    const esperada = `sha256=${createHmac("sha256", llaveDelLab(ENV.BOT_API_KEY)).update(pedido!.cuerpo).digest("hex")}`;
    expect(pedido!.firma).toBe(esperada);
    expect(llaveDelLab(ENV.BOT_API_KEY)).not.toBe(llaveDelGasto(ENV.BOT_API_KEY));
  });

  it.each([
    ["un 404", () => new Response('{"error":"sin_configuracion"}', { status: 404 })],
    ["otro negocio", () => new Response(JSON.stringify({ ...ACADEMIA, organizationId: "org_b" }))],
    ["una forma inválida", () => new Response(JSON.stringify({ negocio: "x" }))],
  ])("con %s: null (el Laboratorio sigue con guiones neutros)", async (_n, respuesta) => {
    const fetchFalso = (async () => respuesta()) as unknown as typeof fetch;
    expect(await pedirNegocioDelLab("org_a", { env: ENV, fetch: fetchFalso })).toBeNull();
  });

  it("si el cerebro no responde o no está configurado: null", async () => {
    const caido = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(await pedirNegocioDelLab("org_a", { env: ENV, fetch: caido })).toBeNull();
    expect(await pedirNegocioDelLab("org_a", { env: {}, fetch: caido })).toBeNull();
  });
});

describe("083 · el juez compara contra lo que sabe el agente (D6)", () => {
  it("CA-6 el prompt trae los datos del negocio y las reglas del consentimiento", () => {
    const { system, user } = buildJudgePrompt({
      persona: "comprador_decidido",
      transcript: [{ role: "cliente", text: "Hola" }],
      kbText: "",
      negocioText: renderNegocio(ACADEMIA),
      behaviorText: "",
    });
    expect(user).toContain("DATOS DEL NEGOCIO");
    expect(user).toContain("Curso de Excel (precio: $300.000; duración: 8 horas)");
    expect(user).toContain("Programación web (precio: no configurado (responde una persona)");
    expect(system).toContain("SIN pedir autorización es correcto");
    expect(system).toContain("darle el teléfono del negocio es correcto");
  });
});
