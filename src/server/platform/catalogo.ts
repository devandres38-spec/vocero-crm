import { HERRAMIENTAS, ROLES } from "@/lib/agent-roles";
import { ACCENT_PRESETS, DEFAULT_BRANDING } from "@/lib/branding";
import { CURRENCY_OPTIONS } from "@/lib/money";
import { blueprintJsonSchema } from "@/lib/platform/blueprint";
import { getRegion, REGIONES_SUGERIDAS } from "@/lib/region";
import { ATAJO_MAX, TEXTO_MAX, TOPE_RESPUESTAS } from "@/lib/respuestas-rapidas";
import { DENSIDADES, LETRAS, TAMANOS, TEMAS } from "@/lib/temas";
import { dominioBase, SLUG_REGEX, SLUGS_RESERVADOS } from "@/lib/tenancy";
import { LIMITS } from "@/server/agenda/settings";
import { CATALOGO_VERTICAL, techoDeInstancia } from "@/server/modulos/efectivos";

/**
 * 069 (D13) — Los valores válidos para armar un Blueprint, para que una IA (o
 * un script) no tenga que adivinarlos: roles y herramientas del agente,
 * monedas, módulos que esta instancia permite (el techo), reglas del slug y el
 * JSON Schema del contrato. Auditoría 069 (Fix-B): además presets de color,
 * temas, regiones sugeridas, etapas por defecto y dos ejemplos, para que una
 * IA acierte a la primera en vez de iterar sobre errores 422.
 */


/** Las etapas con que nace un negocio (`sembrarOrganizacion`). */
export const ETAPAS_POR_DEFECTO = {
  open: ["Nuevo", "En conversación", "Interesado"],
  anchors: { won: "Cliente", lost: "Perdido" },
} as const;

export const EJEMPLO_MINIMO = {
  version: 1,
  organization: { slug: "ferreteria-rojas", name: "Ferretería Rojas" },
  owner: { email: "dueno@ferreteriarojas.co" },
};

/** Colombia: la primera región sugerida. */
const CO = REGIONES_SUGERIDAS[0];

export const EJEMPLO_COMPLETO = {
  version: 1,
  organization: { slug: "clinica-sol", name: "Clínica Sol" },
  region: { country: CO.country, locale: CO.locale, timezone: CO.timezone },
  brand: { name: "Clínica Sol", accent: "#0d3b9e", currency: CO.currency },
  appearance: { tema: "vocero", letra: "urbanist", tamano: "normal", densidad: "normal" },
  modules: { agenda: true },
  pipeline: { stages: ["Nuevo", "Valoración agendada", "Tratamiento propuesto"] },
  agent: {
    name: "Sofía",
    role: "calificador",
    tone: "Cálida y profesional, tutea con respeto.",
    greeting: "¡Hola! Soy Sofía de Clínica Sol. ¿En qué te ayudo?",
    instructions: "Agenda valoraciones; no des diagnósticos.",
    escalationRules: "Pasa a una persona si hay dolor intenso o una queja.",
    tools: null,
  },
  knowledge: {
    mode: "merge",
    entries: [
      { kind: "qa", question: "¿Dónde quedan?", answer: "Calle 10 # 20-30, Medellín." },
      { kind: "block", content: "Horario: lunes a viernes de 8:00 a 17:00.\nSábados de 8:00 a 12:00." },
    ],
  },
  agenda: {
    weeklyHours: {
      mon: [{ start: "08:00", end: "12:00" }, { start: "14:00", end: "17:00" }],
      tue: [{ start: "08:00", end: "12:00" }, { start: "14:00", end: "17:00" }],
      sat: [{ start: "08:00", end: "12:00" }],
    },
    slotMinutes: 45,
    bufferMinutes: 15,
    minNoticeHours: 2,
    maxDaysAhead: 21,
    timezone: CO.timezone,
  },
  quickReplies: {
    mode: "merge",
    entries: [
      { shortcut: "direccion", text: "Estamos en la Calle 10 # 20-30, Medellín." },
      { shortcut: "pagos", text: "Recibimos efectivo, tarjeta y Nequi, {nombre}." },
    ],
  },
  owner: { email: "duena@clinicasol.co" },
};

export function catalogoPlataforma() {
  const techo = techoDeInstancia();
  const region = getRegion();
  return {
    blueprintVersion: 1,
    baseDomain: dominioBase(),
    regionDefaults: { country: region.country, locale: region.locale, timezone: region.timezone, currency: region.currency },
    regionSuggestions: REGIONES_SUGERIDAS,
    slug: { pattern: SLUG_REGEX.source, reserved: [...SLUGS_RESERVADOS].sort(), immutable: true },
    brand: {
      defaultAccent: DEFAULT_BRANDING.accent,
      accentPresets: Object.entries(ACCENT_PRESETS).map(([hex, p]) => ({ accent: hex, label: p.label })),
      nameMaxLength: 30,
    },
    appearance: {
      themes: Object.entries(TEMAS).map(([id, t]) => ({ id, name: t.nombre, mode: t.modo, description: t.descripcion })),
      custom: "tema: \"propio\" exige propio: { fondo, texto, marco } en hex con contraste legible",
      fonts: Object.keys(LETRAS),
      sizes: Object.keys(TAMANOS),
      densities: Object.keys(DENSIDADES),
    },
    agent: {
      roles: Object.values(ROLES).map((r) => ({ key: r.clave, label: r.etiqueta, description: r.descripcion })),
      tools: HERRAMIENTAS.map((h) => ({ key: h.clave, label: h.etiqueta, requiresAgenda: h.agenda === true, alwaysOn: h.fija === true })),
    },
    currencies: CURRENCY_OPTIONS.map((c) => c.code),
    modules: {
      ceiling: { agenda: techo.agenda, atribucion: techo.atribucion, channels: [...techo.channels] },
      verticals: [...CATALOGO_VERTICAL],
      alwaysOn: ["whatsapp"],
    },
    pipeline: { defaultStages: ETAPAS_POR_DEFECTO, maxOpenStages: 20 },
    agenda: { limits: LIMITS, connectors: ["enlace-fijo"], weekdays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], maxIntervalsPerDay: 6 },
    knowledge: { modes: ["merge", "exact"], maxEntries: 500 },
    quickReplies: {
      modes: ["merge", "exact"],
      maxEntries: TOPE_RESPUESTAS,
      shortcut: { pattern: "^[a-z0-9_-]{1,32}$", maxLength: ATAJO_MAX, normalized: "sin /, acentos ni espacios" },
      textMaxLength: TEXTO_MAX,
      variables: ["{nombre}"],
    },
    examples: { minimal: EJEMPLO_MINIMO, complete: EJEMPLO_COMPLETO },
    schema: blueprintJsonSchema(),
  };
}
