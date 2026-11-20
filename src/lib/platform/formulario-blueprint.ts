import type { OrganizationBlueprint, SeccionBlueprint } from "@/lib/platform/blueprint";
import { esTrato } from "@/lib/agent-roles";
import { APARIENCIA_POR_DEFECTO, type Apariencia } from "@/lib/temas";
import { normalizarAtajo } from "@/lib/respuestas-rapidas";
import { REGIONES_SUGERIDAS } from "@/lib/region";
import { opcionesDeTexto, type FichaField } from "@/lib/ficha-campos";
import type { VerticalOverrides } from "@/verticals/resolver";
import { semillaDe } from "@/verticals/semilla";

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

/**
 * Auditoría final (F-07) — `uid`: id local y estable de cada elemento de una
 * lista editable (para `key` de React al reordenar o quitar). Nunca se envía.
 */
type ConUid = { uid?: string };
export type Franja = { start: string; end: string } & ConUid;
export type EntradaKb = ({ kind: "qa"; question: string; answer: string } | { kind: "block"; content: string }) & ConUid;
export type RespuestaRapidaForm = { shortcut: string; text: string } & ConUid;
/**
 * 072 (auditoría 072-A, A-2/A-3/B-3) — Un campo de la ficha en el formulario:
 * `uid` estable (la `key` cambia con el nombre), `opcionesTexto` crudo (una
 * opción por línea; se parsea al serializar, no en cada tecla) y `guardado`
 * (ya existe en el negocio: su tipo no se puede cambiar). Nada de esto viaja.
 */
export type CampoFichaForm = FichaField & ConUid & { opcionesTexto?: string; guardado?: boolean };

let contadorUid = 0;
/** Un id local único en esta pestaña del navegador (sin `crypto.randomUUID`: no existe por HTTP). */
export function nuevoUid(): string {
  contadorUid += 1;
  return `u${contadorUid.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
const conUid = <T extends object>(x: T): T & ConUid => ({ ...x, uid: (x as ConUid).uid ?? nuevoUid() });

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
export type ModulosForm = {
  agenda: boolean;
  atribucion: boolean;
  channels: string[];
  /**
   * 072-B — `modules.modules`: los módulos de código (`src/modulos/`) que la
   * agencia enciende para este negocio. Se conservan tal cual al importar o
   * editar (antes el formulario los descartaba al guardar).
   */
  verticales?: string[];
  /** El negocio ya tenía alguno: guardar debe mandar la lista aunque quede vacía (para apagarlos). */
  verticalesGuardados?: boolean;
};

export type FormBlueprint = {
  organization: { name: string; slug: string; slugTocado: boolean };
  region: { country: string; locale: string; timezone: string };
  brand: { name: string; nameTocado: boolean; accent: string; currency: string };
  /**
   * `guardada` (F-02): el negocio ya tenía esa sección. Al editar, el
   * Blueprint no sabe «borrar» una apariencia o una agenda: el interruptor
   * `usar` no se ofrece y la sección se edita en su lugar.
   */
  appearance: { usar: boolean; guardada: boolean; valor: Apariencia };
  modules: ModulosForm;
  pipeline: { stages: string[] };
  agent: {
    name: string;
    role: string;
    tone: string;
    greeting: string;
    instructions: string;
    escalationRules: string;
    /** 071 — `""` = sin cambiar (el negocio conserva el suyo; uno nuevo, `tu`). */
    treatment: string;
    /** 071 — `null` = sin cambiar (uno nuevo cierra las conversaciones sin rumbo). */
    stallEnabled: boolean | null;
    /** `true` = todas las herramientas (también las que se agreguen después). */
    todas: boolean;
    tools: string[];
  };
  knowledge: { mode: "merge" | "exact"; entries: EntradaKb[] };
  agenda: {
    usar: boolean;
    guardada: boolean;
    weeklyHours: Record<DiaSemana, Franja[]>;
    slotMinutes: number;
    bufferMinutes: number;
    minNoticeHours: number;
    maxDaysAhead: number;
    timezone: string;
    meetingLink: string;
  };
  quickReplies: { mode: "merge" | "exact"; entries: RespuestaRapidaForm[] };
  /** 070 — El despliegue de cerebro asignado (`""` = ninguno, bandeja manual). */
  brain: { deployment: string };
  /** 072 — El Vertical Pack (la plantilla se carga aparte, a pedido). */
  /**
   * M-1 (auditoría 072-A) — `overrides` viaja de pasada (se editan en la
   * pestaña JSON o por MCP): ausente = no tocarlos; `null` = quitarlos.
   * Antes el formulario los perdía al importar o editar.
   */
  vertical: { pack: string; overrides?: VerticalOverrides | null };
  /** 072 — Los campos de la ficha del negocio. */
  fichaFields: { fields: CampoFichaForm[] };
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
  for (const dia of DIAS_LABORABLES) semana[dia] = [conUid({ start: "09:00", end: "18:00" })];
  return {
    organization: { name: "", slug: "", slugTocado: false },
    region: { country: d.country, locale: d.locale, timezone: d.timezone },
    brand: { name: "", nameTocado: false, accent: d.accent, currency: d.currency },
    appearance: { usar: false, guardada: false, valor: { ...APARIENCIA_POR_DEFECTO } },
    modules: { agenda: techo.agenda, atribucion: techo.atribucion, channels: ["whatsapp", ...techo.channels.filter((c) => c !== "whatsapp")] },
    pipeline: { stages: [...d.etapas] },
    agent: {
      name: "",
      role: "",
      tone: "",
      greeting: "",
      instructions: "",
      escalationRules: "",
      treatment: "",
      stallEnabled: null,
      todas: true,
      tools: [],
    },
    knowledge: { mode: "merge", entries: [] },
    agenda: {
      usar: false,
      guardada: false,
      weeklyHours: semana,
      slotMinutes: 30,
      bufferMinutes: 0,
      minNoticeHours: 2,
      maxDaysAhead: 7,
      timezone: d.timezone,
      meetingLink: "",
    },
    quickReplies: { mode: "merge", entries: [] },
    brain: { deployment: "" },
    vertical: { pack: "default" },
    fichaFields: { fields: [] },
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
  if (bp.appearance) f.appearance = { usar: true, guardada: true, valor: { ...(bp.appearance as Apariencia) } };
  const m = modulosEfectivos ?? f.modules;
  f.modules = {
    agenda: bp.modules?.agenda ?? m.agenda,
    atribucion: bp.modules?.atribucion ?? m.atribucion,
    channels: ["whatsapp", ...((bp.modules?.channels ?? m.channels) as string[]).filter((c) => c !== "whatsapp")],
  };
  // 072-B — Los módulos de código del Blueprint (o los efectivos del negocio).
  const verticales = [...new Set(((bp.modules?.modules ?? m.verticales ?? []) as string[]).filter((x) => typeof x === "string"))];
  if (verticales.length > 0) {
    f.modules.verticales = verticales;
    f.modules.verticalesGuardados = true;
  }
  f.pipeline = { stages: bp.pipeline?.stages ? [...bp.pipeline.stages] : [] };
  if (bp.agent) {
    f.agent = {
      name: bp.agent.name ?? "",
      role: bp.agent.role ?? "",
      tone: bp.agent.tone ?? "",
      greeting: bp.agent.greeting ?? "",
      instructions: bp.agent.instructions ?? "",
      escalationRules: bp.agent.escalationRules ?? "",
      treatment: bp.agent.treatment ?? "",
      stallEnabled: bp.agent.stallEnabled ?? null,
      todas: bp.agent.tools === null || bp.agent.tools === undefined,
      tools: bp.agent.tools ? [...bp.agent.tools] : [],
    };
  }
  if (bp.knowledge) {
    f.knowledge = { mode: bp.knowledge.mode ?? "merge", entries: bp.knowledge.entries.map((e) => conUid({ ...e })) };
  }
  if (bp.agenda) {
    const semana = semanaVacia();
    for (const [dia] of DIAS_SEMANA) semana[dia] = (bp.agenda.weeklyHours?.[dia] ?? []).map((x) => conUid({ ...x }));
    f.agenda = {
      usar: true,
      guardada: true,
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
    f.quickReplies = { mode: bp.quickReplies.mode ?? "merge", entries: bp.quickReplies.entries.map((e) => conUid({ ...e })) };
  }
  f.brain = { deployment: bp.brain?.deployment ?? "" };
  f.vertical = {
    pack: bp.vertical?.pack ?? "default",
    ...(bp.vertical && bp.vertical.overrides !== undefined ? { overrides: bp.vertical.overrides } : {}),
  };
  f.fichaFields = {
    fields: bp.fichaFields?.fields ? bp.fichaFields.fields.map((c) => conUid({ ...c, guardado: true })) : [],
  };
  return f;
}

/**
 * 072 (US1) — «Empezar desde plantilla»: un formulario NUEVO con la semilla
 * del pack (etapas, agente, ficha, conocimiento, respuestas, apariencia y
 * acento). El nombre, la dirección, la región y los módulos son del negocio.
 */
export function formularioDesdePlantilla(packId: string, d: DefaultsForm, techo: TechoForm): FormBlueprint {
  const f = formularioDesdeBlueprint({ version: 1, ...semillaDe(packId) } as OrganizationBlueprint, d, techo);
  f.organization = { name: "", slug: "", slugTocado: false };
  f.brand = { ...f.brand, name: "", nameTocado: false };
  f.appearance = { ...f.appearance, guardada: false };
  // Los campos de una plantilla todavía no existen en ningún negocio.
  f.fichaFields = { fields: f.fichaFields.fields.map((c) => ({ ...c, guardado: false })) };
  return f;
}

/**
 * 072 (US1.4) — «Aplicar plantilla» a un negocio que ya existe: carga la
 * semilla EN el formulario (las pestañas que cambian se marcan) y se revisa
 * con «Revisar cambios» antes de guardar. Conocimiento y respuestas rápidas
 * se suman (`merge`): no se borra lo que el negocio ya escribió. Negocio,
 * región, nombre de marca, módulos, agenda y cerebro no se tocan.
 */
export function aplicarPlantillaAlFormulario(f: FormBlueprint, packId: string, d: DefaultsForm, techo: TechoForm): FormBlueprint {
  const p = formularioDesdePlantilla(packId, d, techo);
  return {
    ...f,
    brand: { ...f.brand, accent: p.brand.accent },
    appearance: { usar: true, guardada: f.appearance.guardada, valor: p.appearance.valor },
    pipeline: p.pipeline.stages.length > 0 ? p.pipeline : f.pipeline,
    agent: p.agent.name ? p.agent : f.agent,
    knowledge: { mode: "merge", entries: [...f.knowledge.entries, ...p.knowledge.entries.filter((e) => !f.knowledge.entries.some((x) => igual(sinUid(x), sinUid(e))))] },
    quickReplies: { mode: "merge", entries: [...f.quickReplies.entries, ...p.quickReplies.entries.filter((e) => !f.quickReplies.entries.some((x) => x.shortcut === e.shortcut))] },
    vertical: { ...f.vertical, pack: p.vertical.pack },
    fichaFields: p.fichaFields.fields.length > 0 ? p.fichaFields : f.fichaFields,
  };
}

function sinUid<T extends { uid?: string }>(x: T): Omit<T, "uid"> {
  const { uid: _uid, ...resto } = x;
  void _uid;
  return resto;
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
  if (f.appearance.usar || f.appearance.guardada) {
    const a = f.appearance.valor;
    s.appearance = a.tema === "propio" ? { ...a } : { tema: a.tema, letra: a.letra, tamano: a.tamano, densidad: a.densidad };
  }
  s.modules = {
    ...(techo.agenda ? { agenda: f.modules.agenda } : {}),
    ...(techo.atribucion ? { atribucion: f.modules.atribucion } : {}),
    channels: ["whatsapp", ...f.modules.channels.filter((c) => c !== "whatsapp" && techo.channels.includes(c))],
    // 072-B — Solo si hay alguno, o si el negocio tenía y se apagaron todos
    // (el merge por clave conserva lo que no se menciona).
    ...((f.modules.verticales?.length ?? 0) > 0 || f.modules.verticalesGuardados
      ? { modules: [...(f.modules.verticales ?? [])] }
      : {}),
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
    ...(esTrato(a.treatment) ? { treatment: a.treatment } : {}),
    ...(a.stallEnabled !== null ? { stallEnabled: a.stallEnabled } : {}),
  };
  const agenteVacio =
    !agente.name && !agente.role && !agente.treatment && agente.stallEnabled === undefined && agente.tools === null && [agente.tone, agente.greeting, agente.instructions, agente.escalationRules].every((x) => x === null);
  if (!(modo === "crear" && agenteVacio)) s.agent = agente;

  const entradas = f.knowledge.entries
    .map((e): EntradaKb => (e.kind === "qa" ? { kind: "qa", question: t(e.question), answer: t(e.answer) } : { kind: "block", content: t(e.content) }))
    .filter((e) => (e.kind === "qa" ? e.question && e.answer : e.content));
  if (!(modo === "crear" && entradas.length === 0)) s.knowledge = { mode: f.knowledge.mode, entries: entradas };

  if (f.agenda.usar || f.agenda.guardada) {
    const g = f.agenda;
    const semana = Object.fromEntries(
      DIAS_SEMANA.map(([d]) => [d, g.weeklyHours[d].filter((x) => x.start && x.end).map((x) => ({ start: x.start, end: x.end }))] as const).filter(
        ([, xs]) => xs.length > 0
      )
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

  // 070 — Al crear, solo si se eligió uno; al editar, también `null` (quitarlo).
  const cerebro = t(f.brain.deployment);
  if (cerebro) s.brain = { deployment: cerebro };
  else if (modo === "editar") s.brain = null;

  // 072 — Al crear, solo si se eligió un nicho o hay campos; al editar,
  // siempre (y viaja solo si cambió respecto de lo cargado).
  const hayOverrides = f.vertical.overrides !== undefined;
  if (modo === "editar" || f.vertical.pack !== "default" || hayOverrides) {
    s.vertical = { pack: f.vertical.pack, ...(hayOverrides ? { overrides: f.vertical.overrides } : {}) };
  }
  if (modo === "editar" || f.fichaFields.fields.length > 0) s.fichaFields = { fields: f.fichaFields.fields.map(campoParaEnviar) };

  if (modo === "crear" && t(f.owner.email)) s.owner = { email: t(f.owner.email) };
  return s;
}

/** Pura: el campo tal como viaja (sin `uid`, `guardado` ni el texto crudo de opciones). */
export function campoParaEnviar(c: CampoFichaForm): FichaField {
  const { uid: _u, guardado: _g, opcionesTexto, options, ...resto } = c;
  void _u;
  void _g;
  const opciones = c.type === "select" ? (opcionesTexto !== undefined ? opcionesDeTexto(opcionesTexto) : options) : undefined;
  return { ...resto, ...(opciones !== undefined ? { options: opciones } : {}) };
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
  brain: "agente",
  vertical: "nicho",
  fichaFields: "nicho",
  // 073-B — Solo por JSON avanzado (o API/MCP): no tienen formulario propio.
  bot: "json",
  humanHours: "json",
};

/** Pura: copiar el horario de un día a lunes–viernes (con ids nuevos). */
export function copiarALaborables(semana: Record<DiaSemana, Franja[]>, desde: DiaSemana): Record<DiaSemana, Franja[]> {
  const copia = { ...semana };
  for (const d of DIAS_LABORABLES) copia[d] = semana[desde].map((x) => ({ start: x.start, end: x.end, uid: nuevoUid() }));
  return copia;
}

/** Pura (F-07): ¿una tarjeta de conocimiento está completa? Las incompletas no se envían. */
export function entradaKbCompleta(e: EntradaKb): boolean {
  return e.kind === "qa" ? Boolean(e.question.trim() && e.answer.trim()) : Boolean(e.content.trim());
}

/** Pura (F-07): ¿una respuesta rápida está completa (atajo válido tras normalizar y texto)? */
export function respuestaCompleta(r: RespuestaRapidaForm): boolean {
  return Boolean(normalizarAtajo(r.shortcut) && r.text.trim());
}

/** Pura (F-07): cuántas tarjetas se descartarían al enviar, para avisar antes. */
export function tarjetasIncompletas(f: FormBlueprint): { conocimiento: number; respuestas: number } {
  return {
    conocimiento: f.knowledge.entries.filter((e) => !entradaKbCompleta(e)).length,
    respuestas: f.quickReplies.entries.filter((r) => !respuestaCompleta(r)).length,
  };
}

/**
 * Pura (auditoría final F-06): qué cambia al elegir un país. Siempre idioma y
 * zona; la moneda y la zona de la agenda SOLO al crear: en un negocio que ya
 * opera, cambiarlas es una decisión aparte (Marca y Agenda).
 */
export function cambiosAlElegirPais(
  country: string,
  modo: ModoFormulario
): {
  region: Partial<FormBlueprint["region"]>;
  brand?: Partial<FormBlueprint["brand"]>;
  agenda?: Partial<FormBlueprint["agenda"]>;
} {
  const r = REGIONES_SUGERIDAS.find((x) => x.country === country);
  if (!r) return { region: { country } };
  return {
    region: { country: r.country, locale: r.locale, timezone: r.timezone },
    ...(modo === "crear" ? { brand: { currency: r.currency }, agenda: { timezone: r.timezone } } : {}),
  };
}
