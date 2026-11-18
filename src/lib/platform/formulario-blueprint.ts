import type { OrganizationBlueprint, SeccionBlueprint } from "@/lib/platform/blueprint";
import { APARIENCIA_POR_DEFECTO, type Apariencia } from "@/lib/temas";

/**
 * Auditoría 069 (Fix-C) — El estado del `FormularioBlueprint` de `/platform`
 * y su traducción, en las dos direcciones, a un `OrganizationBlueprint`.
 * Puro (sin React ni servidor): lo prueba `formulario-blueprint.test.ts`.
 *
 * - Crear: se mandan todas las secciones con contenido.
 * - Editar: solo las secciones cuyo JSON cambió respecto de lo cargado (el
 *   Blueprint es declarativo: lo ausente no se toca).
 */

export const DIAS_SEMANA = [
  ["mon", "Lunes"],
  ["tue", "Martes"],
  ["wed", "Miércoles"],
  ["thu", "Jueves"],
  ["fri", "Viernes"],
  ["sat", "Sábado"],
  ["sun", "Domingo"],
] as const;
export type DiaSemana = (typeof DIAS_SEMANA)[number][0];
export const DIAS_LABORABLES: DiaSemana[] = ["mon", "tue", "wed", "thu", "fri"];

export type Franja = { start: string; end: string };
export type EntradaKb = { kind: "qa"; question: string; answer: string } | { kind: "block"; content: string };
export type RespuestaRapidaForm = { shortcut: string; text: string };

export type TechoForm = { agenda: boolean; atribucion: boolean; channels: string[] };
export type DefaultsForm = {
  country: string;
  locale: string;
  timezone: string;
  currency: string;
  accent: string;
  /** Etapas abiertas con que nace un negocio. */
  etapas: string[];
};
export type ModulosForm = { agenda: boolean; atribucion: boolean; channels: string[] };

export type FormBlueprint = {
  organization: { name: string; slug: string; slugTocado: boolean };
  region: { country: string; locale: string; timezone: string };
  brand: { name: string; nameTocado: boolean; accent: string; currency: string };
  appearance: { usar: boolean; valor: Apariencia };
  modules: ModulosForm;
  pipeline: { stages: string[] };
  agent: {
    name: string;
    role: string;
    tone: string;
    greeting: string;
    instructions: string;
    escalationRules: string;
    /** `true` = todas las herramientas (también las que se agreguen después). */
    todas: boolean;
    tools: string[];
  };
  knowledge: { mode: "merge" | "exact"; entries: EntradaKb[] };
  agenda: {
    usar: boolean;
    weeklyHours: Record<DiaSemana, Franja[]>;
    slotMinutes: number;
    bufferMinutes: number;
    minNoticeHours: number;
    maxDaysAhead: number;
    timezone: string;
    meetingLink: string;
  };
  quickReplies: { mode: "merge" | "exact"; entries: RespuestaRapidaForm[] };
  owner: { email: string };
};

export type ModoFormulario = "crear" | "editar";

const semanaVacia = (): Record<DiaSemana, Franja[]> =>
  Object.fromEntries(DIAS_SEMANA.map(([d]) => [d, [] as Franja[]])) as Record<DiaSemana, Franja[]>;

/** Pura: el slug sugerido para un nombre («Clínica Sol» → `clinica-sol`). */
export function sugerirSlug(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

/** Un formulario nuevo para crear un negocio. */
export function formularioInicial(d: DefaultsForm, techo: TechoForm): FormBlueprint {
  const semana = semanaVacia();
  for (const dia of DIAS_LABORABLES) semana[dia] = [{ start: "09:00", end: "18:00" }];
  return {
    organization: { name: "", slug: "", slugTocado: false },
    region: { country: d.country, locale: d.locale, timezone: d.timezone },
    brand: { name: "", nameTocado: false, accent: d.accent, currency: d.currency },
    appearance: { usar: false, valor: { ...APARIENCIA_POR_DEFECTO } },
    modules: { agenda: techo.agenda, atribucion: techo.atribucion, channels: ["whatsapp", ...techo.channels.filter((c) => c !== "whatsapp")] },
    pipeline: { stages: [...d.etapas] },
    agent: {
      name: "",
      role: "",
      tone: "",
      greeting: "",
      instructions: "",
      escalationRules: "",
      todas: true,
      tools: [],
    },
    knowledge: { mode: "merge", entries: [] },
    agenda: {
      usar: false,
      weeklyHours: semana,
      slotMinutes: 30,
      bufferMinutes: 0,
      minNoticeHours: 2,
      maxDaysAhead: 7,
      timezone: d.timezone,
      meetingLink: "",
    },
    quickReplies: { mode: "merge", entries: [] },
    owner: { email: "" },
  };
}

/**
 * El formulario de un negocio existente, desde su Blueprint vigente. Lo que
 * el Blueprint no trae (región nunca guardada, módulos heredados) sale de
 * los valores efectivos que pasa la página.
 */
export function formularioDesdeBlueprint(
  bp: OrganizationBlueprint,
  d: DefaultsForm,
  techo: TechoForm,
  modulosEfectivos?: ModulosForm
): FormBlueprint {
  const f = formularioInicial(d, techo);
  f.organization = { name: bp.organization?.name ?? "", slug: bp.organization?.slug ?? "", slugTocado: true };
  f.region = {
    country: bp.region?.country ?? d.country,
    locale: bp.region?.locale ?? d.locale,
    timezone: bp.region?.timezone ?? d.timezone,
  };
  f.brand = {
    name: bp.brand?.name ?? f.organization.name.slice(0, 30),
    nameTocado: true,
    accent: bp.brand?.accent ?? d.accent,
    currency: bp.brand?.currency ?? d.currency,
  };
  if (bp.appearance) f.appearance = { usar: true, valor: { ...(bp.appearance as Apariencia) } };
  const m = modulosEfectivos ?? f.modules;
  f.modules = {
    agenda: bp.modules?.agenda ?? m.agenda,
    atribucion: bp.modules?.atribucion ?? m.atribucion,
    channels: ["whatsapp", ...((bp.modules?.channels ?? m.channels) as string[]).filter((c) => c !== "whatsapp")],
  };
  f.pipeline = { stages: bp.pipeline?.stages ? [...bp.pipeline.stages] : [] };
  if (bp.agent) {
    f.agent = {
      name: bp.agent.name ?? "",
      role: bp.agent.role ?? "",
      tone: bp.agent.tone ?? "",
      greeting: bp.agent.greeting ?? "",
      instructions: bp.agent.instructions ?? "",
      escalationRules: bp.agent.escalationRules ?? "",
      todas: bp.agent.tools === null || bp.agent.tools === undefined,
      tools: bp.agent.tools ? [...bp.agent.tools] : [],
    };
  }
  if (bp.knowledge) {
    f.knowledge = { mode: bp.knowledge.mode ?? "merge", entries: bp.knowledge.entries.map((e) => ({ ...e })) };
  }
  if (bp.agenda) {
    const semana = semanaVacia();
    for (const [dia] of DIAS_SEMANA) semana[dia] = (bp.agenda.weeklyHours?.[dia] ?? []).map((x) => ({ ...x }));
    f.agenda = {
      usar: true,
      weeklyHours: bp.agenda.weeklyHours ? semana : f.agenda.weeklyHours,
      slotMinutes: bp.agenda.slotMinutes ?? f.agenda.slotMinutes,
      bufferMinutes: bp.agenda.bufferMinutes ?? f.agenda.bufferMinutes,
      minNoticeHours: bp.agenda.minNoticeHours ?? f.agenda.minNoticeHours,
      maxDaysAhead: bp.agenda.maxDaysAhead ?? f.agenda.maxDaysAhead,
      timezone: bp.agenda.timezone ?? f.region.timezone,
      meetingLink: bp.agenda.meetingLink ?? "",
    };
  }
  if (bp.quickReplies) {
    f.quickReplies = { mode: bp.quickReplies.mode ?? "merge", entries: bp.quickReplies.entries.map((e) => ({ ...e })) };
  }
  return f;
}

const t = (s: string) => s.trim();
const nulo = (s: string) => (s.trim() ? s.trim() : null);

/**
 * Pura: el valor de cada sección del Blueprint según el formulario. Una
 * sección sin contenido que mandar es `undefined`.
 */
export function seccionesDelFormulario(
  f: FormBlueprint,
  modo: ModoFormulario,
  techo: TechoForm
): Partial<Record<SeccionBlueprint, unknown>> {
  const s: Partial<Record<SeccionBlueprint, unknown>> = {};
  const nombre = t(f.organization.name);

  s.organization =
    modo === "crear"
      ? { slug: f.organization.slugTocado ? t(f.organization.slug) : sugerirSlug(nombre), name: nombre }
      : { name: nombre };
  s.region = { country: t(f.region.country).toUpperCase(), locale: t(f.region.locale), timezone: t(f.region.timezone) };
  s.brand = {
    name: (f.brand.nameTocado ? t(f.brand.name) : nombre).slice(0, 30) || nombre.slice(0, 30),
    accent: t(f.brand.accent).toLowerCase(),
    currency: f.brand.currency,
  };
  if (f.appearance.usar) {
    const a = f.appearance.valor;
    s.appearance = a.tema === "propio" ? { ...a } : { tema: a.tema, letra: a.letra, tamano: a.tamano, densidad: a.densidad };
  }
  s.modules = {
    ...(techo.agenda ? { agenda: f.modules.agenda } : {}),
    ...(techo.atribucion ? { atribucion: f.modules.atribucion } : {}),
    channels: ["whatsapp", ...f.modules.channels.filter((c) => c !== "whatsapp" && techo.channels.includes(c))],
  };
  const etapas = f.pipeline.stages.map(t).filter(Boolean);
  if (etapas.length > 0) s.pipeline = { stages: etapas };

  const a = f.agent;
  const agente = {
    ...(t(a.name) ? { name: t(a.name) } : {}),
    ...(a.role ? { role: a.role } : {}),
    tone: nulo(a.tone),
    greeting: nulo(a.greeting),
    instructions: nulo(a.instructions),
    escalationRules: nulo(a.escalationRules),
    tools: a.todas ? null : [...a.tools],
  };
  const agenteVacio =
    !agente.name && !agente.role && agente.tools === null && [agente.tone, agente.greeting, agente.instructions, agente.escalationRules].every((x) => x === null);
  if (!(modo === "crear" && agenteVacio)) s.agent = agente;

  const entradas = f.knowledge.entries
    .map((e): EntradaKb => (e.kind === "qa" ? { kind: "qa", question: t(e.question), answer: t(e.answer) } : { kind: "block", content: t(e.content) }))
    .filter((e) => (e.kind === "qa" ? e.question && e.answer : e.content));
  if (!(modo === "crear" && entradas.length === 0)) s.knowledge = { mode: f.knowledge.mode, entries: entradas };

  if (f.agenda.usar) {
    const g = f.agenda;
    const semana = Object.fromEntries(
      DIAS_SEMANA.map(([d]) => [d, g.weeklyHours[d].filter((x) => x.start && x.end)] as const).filter(([, xs]) => xs.length > 0)
    );
    const enlace = t(g.meetingLink);
    s.agenda = {
      weeklyHours: semana,
      slotMinutes: g.slotMinutes,
      bufferMinutes: g.bufferMinutes,
      minNoticeHours: g.minNoticeHours,
      maxDaysAhead: g.maxDaysAhead,
      timezone: t(g.timezone),
      ...(enlace ? { connector: "enlace-fijo" } : {}),
      meetingLink: enlace || null,
    };
  }

  const respuestas = f.quickReplies.entries
    .map((r) => ({ shortcut: t(r.shortcut), text: t(r.text) }))
    .filter((r) => r.shortcut && r.text);
  if (!(modo === "crear" && respuestas.length === 0)) s.quickReplies = { mode: f.quickReplies.mode, entries: respuestas };

  if (modo === "crear" && t(f.owner.email)) s.owner = { email: t(f.owner.email) };
  return s;
}

/** Pura: igualdad por JSON con claves ordenadas. */
function igual(a: unknown, b: unknown): boolean {
  const orden = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(orden)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .filter(([, x]) => x !== undefined)
              .sort(([x], [y]) => x.localeCompare(y))
              .map(([k, x]) => [k, orden(x)])
          )
        : v;
  return JSON.stringify(orden(a)) === JSON.stringify(orden(b));
}

/**
 * Pura: el Blueprint a mandar. Al crear, todo lo que tiene contenido; al
 * editar, solo las secciones que cambiaron respecto de `base` (las
 * secciones del formulario tal como se cargó).
 */
export function blueprintParaEnviar(
  f: FormBlueprint,
  modo: ModoFormulario,
  techo: TechoForm,
  base?: Partial<Record<SeccionBlueprint, unknown>>
): { blueprint: Record<string, unknown>; modificadas: SeccionBlueprint[] } {
  const ahora = seccionesDelFormulario(f, modo, techo);
  const modificadas = (Object.keys(ahora) as SeccionBlueprint[]).filter(
    (k) => ahora[k] !== undefined && (modo === "crear" || !base || !igual(ahora[k], base[k]))
  );
  const blueprint: Record<string, unknown> = { version: 1 };
  for (const k of modificadas) blueprint[k] = ahora[k];
  return { blueprint, modificadas };
}

/** En qué pestaña vive cada sección (para marcar errores y cambios). */
export const PESTANA_DE_SECCION: Record<SeccionBlueprint, string> = {
  organization: "negocio",
  region: "negocio",
  owner: "negocio",
  brand: "marca",
  appearance: "marca",
  modules: "modulos",
  pipeline: "pipeline",
  agent: "agente",
  knowledge: "conocimiento",
  agenda: "agenda",
  quickReplies: "respuestas",
};

/** Pura: copiar el horario de un día a lunes–viernes. */
export function copiarALaborables(semana: Record<DiaSemana, Franja[]>, desde: DiaSemana): Record<DiaSemana, Franja[]> {
  const copia = { ...semana };
  for (const d of DIAS_LABORABLES) copia[d] = semana[desde].map((x) => ({ ...x }));
  return copia;
}
