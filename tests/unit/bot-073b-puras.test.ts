import { describe, expect, it } from "vitest";
import { botSeccionSchema, fusionarBot, LIMITES_POR_DEFECTO, leerAjustesBot } from "@/lib/ajustes-bot";
import { CONFIRMACION_BAJA, notaDeBaja, pideBaja } from "@/lib/baja";
import { necesitaAtencionHumana } from "@/lib/filtros-bandeja";
import {
  disponibilidadHumana,
  domingoDePascua,
  esFestivoColombia,
  festivosDeColombia,
  leerHorarioHumano,
} from "@/lib/horario-humano";
import { blueprintSchema } from "@/lib/platform/blueprint";
import { conRespaldo } from "@/server/bot/llm-proxy";
import { topeAlcanzado } from "@/server/dispatch/antiflood";
import { armarTramo, camposDeHorario, HUMAN_GAP_MAX_CARACTERES, HUMAN_GAP_MAX_MENSAJES } from "@/server/brains/humano";

/** 073-B — Lo puro de la ronda: sin base ni red. */

describe("festivos de Colombia (Ley Emiliani)", () => {
  it("Pascua conocida", () => {
    expect(domingoDePascua(2026)).toBe("2026-04-05");
    expect(domingoDePascua(2027)).toBe("2027-03-28");
  });

  it("los 18 festivos de 2026, con los trasladados al lunes", () => {
    expect([...festivosDeColombia(2026)].sort()).toEqual([
      "2026-01-01",
      "2026-01-12", // Reyes (6 ene, martes → lunes 12)
      "2026-03-23", // San José (19 mar, jueves → 23)
      "2026-04-02", // Jueves Santo
      "2026-04-03", // Viernes Santo
      "2026-05-01",
      "2026-05-18", // Ascensión
      "2026-06-08", // Corpus Christi
      "2026-06-15", // Sagrado Corazón
      "2026-06-29", // San Pedro y San Pablo (ya es lunes)
      "2026-07-20",
      "2026-08-07",
      "2026-08-17", // Asunción (15 ago, sábado → 17)
      "2026-10-12", // Día de la Raza (ya es lunes)
      "2026-11-02", // Todos los Santos (1 nov, domingo → 2)
      "2026-11-16", // Independencia de Cartagena (11 nov → 16)
      "2026-12-08",
      "2026-12-25",
    ]);
    expect(esFestivoColombia("2026-11-16")).toBe(true);
    expect(esFestivoColombia("2026-11-11")).toBe(false);
  });
});

describe("disponibilidad humana", () => {
  const BOG = "America/Bogota";
  const horario = leerHorarioHumano({
    weeklyHours: { mon: [{ start: "08:00", end: "18:00" }], tue: [{ start: "08:00", end: "18:00" }] },
    colombianHolidays: true,
  })!;

  it("dentro del horario: hay personas", () => {
    // Lunes 2026-11-23 10:00 en Bogotá = 15:00 UTC.
    expect(disponibilidadHumana(horario, new Date("2026-11-23T15:00:00Z"), BOG)).toEqual({
      humanAvailable: true,
      nextOpenAt: null,
    });
  });

  it("de noche: vuelven al día siguiente a las 08:00 de Bogotá", () => {
    // Lunes 23 a las 20:00 de Bogotá → martes 24 08:00 (13:00 UTC).
    expect(disponibilidadHumana(horario, new Date("2026-11-24T01:00:00Z"), BOG)).toEqual({
      humanAvailable: false,
      nextOpenAt: "2026-11-24T13:00:00.000Z",
    });
  });

  it("un lunes festivo cuenta como cerrado (y se puede apagar)", () => {
    // Lunes 16 nov 2026 (festivo) a las 10:00 → martes 17 08:00.
    const ahora = new Date("2026-11-16T15:00:00Z");
    expect(disponibilidadHumana(horario, ahora, BOG)).toEqual({
      humanAvailable: false,
      nextOpenAt: "2026-11-17T13:00:00.000Z",
    });
    expect(disponibilidadHumana({ ...horario, colombianHolidays: false }, ahora, BOG).humanAvailable).toBe(true);
  });

  it("sin horario guardado, el contexto no lleva nada", () => {
    expect(camposDeHorario({ horario: null, timezone: BOG })).toEqual({});
    expect(leerHorarioHumano({ weeklyHours: { mon: [{ start: "18:00", end: "08:00" }] } })).toBeNull();
    expect(leerHorarioHumano("basura")).toBeNull();
  });
});

describe("detector de baja (Ley 1581)", () => {
  it.each([
    "STOP",
    "Baja",
    "no me escriban más",
    "Por favor no me vuelvan a escribir",
    "dejen de escribirme!!",
    "quiero darme de baja",
    "denme de baja de esa lista",
    "No quiero recibir más mensajes",
    "eliminen mis datos por favor",
  ])("«%s» es baja", (texto) => {
    expect(pideBaja(texto)).toBe(true);
  });

  it.each([
    "no me escribas más tarde, estoy ocupado",
    "no me escriban más hoy, mañana sí",
    "ya no me interesa",
    "me baja el precio?",
    "la baja de precio aplica?",
    "hola",
    "",
  ])("«%s» no es baja (lo decide el agente)", (texto) => {
    expect(pideBaja(texto)).toBe(false);
  });

  it("confirmación fija y nota sin datos del cliente", () => {
    expect(CONFIRMACION_BAJA).toMatch(/no le enviaremos más mensajes/);
    expect(notaDeBaja("detector")).toMatch(/Ley 1581/);
    expect(notaDeBaja("operador")).toMatch(/Una persona del equipo/);
  });
});

describe("anti-flood", () => {
  const L = LIMITES_POR_DEFECTO;
  it("defaults de la decisión #5", () => {
    expect(L).toEqual({ perConversationHour: 25, perConversationDay: 80, perOrganizationDay: 500 });
  });
  it("el tope más estrecho primero", () => {
    expect(topeAlcanzado({ conversacionHora: 24, conversacionDia: 79, organizacionDia: 499 }, L)).toBeNull();
    expect(topeAlcanzado({ conversacionHora: 25, conversacionDia: 25, organizacionDia: 25 }, L)?.alcance).toBe(
      "conversacion_hora"
    );
    expect(topeAlcanzado({ conversacionHora: 3, conversacionDia: 80, organizacionDia: 90 }, L)?.alcance).toBe(
      "conversacion_dia"
    );
    expect(topeAlcanzado({ conversacionHora: 1, conversacionDia: 1, organizacionDia: 500 }, L)).toEqual({
      alcance: "organizacion_dia",
      tope: 500,
      usados: 500,
    });
  });
});

describe("ajustes del bot (plataforma)", () => {
  it("defaults y lo guardado", () => {
    // 074: + playgroundPerDay (40 por defecto, decisión #9).
    expect(leerAjustesBot(undefined)).toEqual({ limits: L0(), temperature: 0.4, fallbackModel: null, playgroundPerDay: 40 });
    expect(leerAjustesBot({ limits: { perConversationHour: 10 }, temperature: 0.2, fallbackModel: "z-ai/glm-4.6" })).toEqual({
      limits: { ...L0(), perConversationHour: 10 },
      temperature: 0.2,
      fallbackModel: "z-ai/glm-4.6",
      playgroundPerDay: 40,
    });
    expect(leerAjustesBot({ temperature: 9 })).toEqual({ limits: L0(), temperature: 0.4, fallbackModel: null, playgroundPerDay: 40 });
    expect(leerAjustesBot({ playgroundPerDay: 100 }).playgroundPerDay).toBe(100);
    expect(fusionarBot({ playgroundPerDay: 100 }, { playgroundPerDay: null })).toEqual({});
  });

  it("merge del Blueprint: ausente no toca, null quita", () => {
    const actual = { limits: { perConversationHour: 10 }, temperature: 0.2, fallbackModel: "a/b" };
    expect(fusionarBot(actual, { limits: { perOrganizationDay: 900 } })).toEqual({
      limits: { perConversationHour: 10, perOrganizationDay: 900 },
      temperature: 0.2,
      fallbackModel: "a/b",
    });
    expect(fusionarBot(actual, { temperature: null, fallbackModel: null })).toEqual({
      limits: { perConversationHour: 10 },
    });
  });

  it("el Blueprint acepta `bot` y `humanHours` y rechaza lo raro", () => {
    expect(
      blueprintSchema.safeParse({
        version: 1,
        bot: { limits: { perConversationHour: 30 }, temperature: 0.3, fallbackModel: "openai/gpt-5-mini" },
        humanHours: { weeklyHours: { mon: [{ start: "08:00", end: "17:00" }] }, colombianHolidays: true },
      }).success
    ).toBe(true);
    expect(blueprintSchema.safeParse({ version: 1, humanHours: null }).success).toBe(true);
    expect(botSeccionSchema.safeParse({ limits: { perConversationHour: 0 } }).success).toBe(false);
    expect(botSeccionSchema.safeParse({ fallbackModel: "https://evil" }).success).toBe(false);
    expect(botSeccionSchema.safeParse({ apiKey: "x" }).success).toBe(false);
  });
});

function L0() {
  return { ...LIMITES_POR_DEFECTO };
}

describe("modelo de respaldo (decisión #8)", () => {
  const OR = "https://openrouter.ai/api/v1";
  const cuerpo = JSON.stringify({ model: "z-ai/glm-5.3-flash", messages: [] });
  it("OpenRouter: models = [principal, respaldo]", () => {
    expect(JSON.parse(conRespaldo(cuerpo, "z-ai/glm-4.6", OR)).models).toEqual(["z-ai/glm-5.3-flash", "z-ai/glm-4.6"]);
  });
  it("sin respaldo, otro proveedor, lista propia o JSON raro: tal cual", () => {
    expect(conRespaldo(cuerpo, null, OR)).toBe(cuerpo);
    expect(conRespaldo(cuerpo, "z-ai/glm-4.6", "https://api.openai.com/v1")).toBe(cuerpo);
    const propio = JSON.stringify({ model: "a/b", models: ["a/b"] });
    expect(conRespaldo(propio, "z/y", OR)).toBe(propio);
    expect(conRespaldo("{no json", "z/y", OR)).toBe("{no json");
    const igual = JSON.stringify({ model: "z/y" });
    expect(conRespaldo(igual, "z/y", OR)).toBe(igual);
  });
});

describe("humanGap: topes del tramo", () => {
  const fila = (i: number, text: string | null, direction: "in" | "out" = "in") => ({
    direction,
    type: text === null ? "image" : "text",
    text,
    createdAt: new Date(Date.UTC(2026, 10, 19, 12, 0, 60 - i)),
  });

  it("orden cronológico, autor y adjuntos sin texto", () => {
    const t = armarTramo([fila(0, "gracias, quedo atento", "in"), fila(1, "Le confirmo el precio: 120.000", "out"), fila(2, null)]);
    expect(t.map((m) => [m.author, m.type, m.text])).toEqual([
      ["lead", "image", null],
      ["humano", "text", "Le confirmo el precio: 120.000"],
      ["lead", "text", "gracias, quedo atento"],
    ]);
  });

  it(`como mucho ${HUMAN_GAP_MAX_MENSAJES} mensajes y ${HUMAN_GAP_MAX_CARACTERES} caracteres (lo último gana)`, () => {
    const muchas = Array.from({ length: 30 }, (_, i) => fila(i, `mensaje ${i} ` + "x".repeat(200)));
    const t = armarTramo(muchas);
    expect(t.length).toBeLessThanOrEqual(HUMAN_GAP_MAX_MENSAJES);
    expect(t.reduce((n, m) => n + (m.text?.length ?? 0), 0)).toBeLessThanOrEqual(HUMAN_GAP_MAX_CARACTERES);
    expect(t.at(-1)!.text).toContain("mensaje 0 ");
  });
});

describe("filtro «Atención humana»", () => {
  it("las que están en handoff", () => {
    expect(necesitaAtencionHumana({ handoffAt: "2026-11-19T10:00:00Z" })).toBe(true);
    expect(necesitaAtencionHumana({ handoffAt: null })).toBe(false);
  });
});
