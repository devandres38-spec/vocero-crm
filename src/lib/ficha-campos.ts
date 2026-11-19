import { z } from "zod";

/**
 * 072 (D9) — Los campos de la ficha que define cada negocio.
 *
 * Es un ESQUEMA sobre `contact.ficha`, no un almacén nuevo: los valores siguen
 * donde el cerebro y la Bandeja ya los escriben (`server/bot/ficha.ts`). Aquí
 * solo se dice qué datos le importan a este negocio, de qué tipo son, en qué
 * orden se piden y cuáles son obligatorios.
 *
 * Puro y sin dependencias del servidor: lo usan el panel de la ficha, Ajustes
 * → Ficha, el Blueprint, el contexto del cerebro y los Vertical Packs.
 */

export const TIPOS_CAMPO = ["text", "number", "date", "select", "boolean"] as const;
export type TipoCampo = (typeof TIPOS_CAMPO)[number];

export const TOPE_CAMPOS = 20;
export const TOPE_OPCIONES = 30;
export const CLAVE_CAMPO_RE = /^[a-z][a-z0-9_]{1,39}$/;
/**
 * `notas` es del bot (siempre existe en `update_ficha`). M-6 (auditoría
 * 072-A): `constructor` y `prototype` chocan con `Object.prototype` al leer
 * `ficha[clave]` en un objeto plano.
 */
export const CLAVES_RESERVADAS: readonly string[] = ["notas", "constructor", "prototype"];

export type FichaField = {
  key: string;
  label: string;
  type: TipoCampo;
  options?: string[];
  required?: boolean;
  description?: string;
};

export type FichaSchema = { version: 1; fields: FichaField[] };

/** Una línea, sin caracteres de control: lo lee el modelo dentro del esquema. */
const unaLinea = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1).max(max));

/** Para comparar opciones: sin acentos, mayúsculas ni espacios de más. */
export function normalizarOpcion(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * B-1 (auditoría 072-A) — Las opciones de una lista escritas a mano: UNA POR
 * LÍNEA. La coma es parte de la opción («Bogotá, D.C.»).
 */
export function opcionesDeTexto(texto: string): string[] {
  return texto
    .split(/\r?\n/)
    .map((o) => o.trim())
    .filter(Boolean);
}

export const fichaFieldSchema = z
  .object({
    key: z
      .string()
      .regex(CLAVE_CAMPO_RE, { message: "clave_invalida" })
      .refine((k) => !CLAVES_RESERVADAS.includes(k), { message: "clave_reservada" }),
    label: unaLinea(60),
    type: z.enum(TIPOS_CAMPO),
    options: z.array(unaLinea(60)).min(1).max(TOPE_OPCIONES).optional(),
    required: z.boolean().optional(),
    description: unaLinea(160).optional(),
  })
  .strict()
  .superRefine((f, ctx) => {
    if (f.type === "select" && !f.options) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "opciones_requeridas" });
    }
    if (f.type !== "select" && f.options) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "opciones_solo_en_select" });
    }
    if (f.options && new Set(f.options.map(normalizarOpcion)).size !== f.options.length) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "opciones_repetidas" });
    }
  });

export const fichaFieldsSchema = z
  .array(fichaFieldSchema)
  .max(TOPE_CAMPOS)
  .refine((fs) => new Set(fs.map((f) => f.key)).size === fs.length, { message: "claves_repetidas" });

/**
 * Lee lo guardado en `organization.ficha_fields`. Tolera basura (la columna es
 * JSON): lo que no valida se trata como «sin esquema», que es el
 * comportamiento de 2.11.0.
 */
export function leerFichaFields(raw: unknown): FichaField[] {
  const r = z.object({ version: z.literal(1), fields: fichaFieldsSchema }).safeParse(raw);
  return r.success ? r.data.fields : [];
}

/** Lo que se guarda y lo que viaja al cerebro; `null` = sin esquema. */
export function aFichaSchema(fields: FichaField[]): FichaSchema | null {
  return fields.length > 0 ? { version: 1, fields } : null;
}

// --- Aplicar el esquema a lo que llega (072, D10) -------------------------

export type ValorFicha = string | number | boolean | null;

export const MOTIVOS_IGNORADO = [
  "no_es_numero",
  "fecha_invalida",
  "opcion_invalida",
  "no_es_booleano",
  "texto_largo",
  "no_es_texto",
] as const;
export type MotivoIgnorado = (typeof MOTIVOS_IGNORADO)[number];
export type Ignorado = { key: string; reason: MotivoIgnorado };

const SI = new Set(["si", "sí", "true", "1", "yes"]);
const NO = new Set(["no", "false", "0"]);

/** `1.200` → 1200, `1,5` → 1.5, `120 invitados` → 120. Formato `es-CO`. */
export function aNumero(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const tokens = v.replace(/[$\s]/g, " ").trim().match(/-?\d[\d.,]*/g);
  if (!tokens || tokens.length !== 1) return null;
  let t = tokens[0]!.replace(/[.,]$/, "");
  // M-7 (auditoría 072-A) — Un separador de miles nunca va tras un 0 inicial:
  // `0.125` es cero coma ciento veinticinco, no 125.
  if (/^-?[1-9]\d{0,2}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^-?[1-9]\d{0,2}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, "");
  else if (/^-?\d+,\d+$/.test(t)) t = t.replace(",", ".");
  else if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function fechaValida(a: number, m: number, d: number): string | null {
  const f = new Date(Date.UTC(a, m - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null;
  if (a < 1900 || a > 2200) return null;
  return f.toISOString().slice(0, 10);
}

/** `AAAA-MM-DD`, o `DD/MM/AAAA` (y con `-`), al formato guardado `AAAA-MM-DD`. */
export function aFecha(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  // M-7 — Anclada: tras el día solo cabe la hora de un ISO (`T…` o espacio);
  // `2026-05-1099` es basura, no el 10 de mayo.
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|T|\s)/.exec(s);
  if (m) return fechaValida(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (m) return fechaValida(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

export function aBooleano(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1 ? true : v === 0 ? false : null;
  if (typeof v !== "string") return null;
  const t = normalizarOpcion(v);
  if (SI.has(t)) return true;
  if (NO.has(t)) return false;
  return null;
}

/** La opción canónica (como la escribió el negocio), sin importar acentos ni mayúsculas. */
export function aOpcion(v: unknown, opciones: readonly string[]): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const t = normalizarOpcion(String(v));
  return opciones.find((o) => normalizarOpcion(o) === t) ?? null;
}

const TEXTO_MAX = 500;

/** Un valor contra su campo: el valor guardable o el motivo para ignorarlo. */
export function coaccionar(campo: FichaField, v: unknown): { ok: true; valor: ValorFicha } | { ok: false; reason: MotivoIgnorado } {
  if (v === null) return { ok: true, valor: null };
  switch (campo.type) {
    case "number": {
      const n = aNumero(v);
      return n === null ? { ok: false, reason: "no_es_numero" } : { ok: true, valor: n };
    }
    case "date": {
      const f = aFecha(v);
      return f === null ? { ok: false, reason: "fecha_invalida" } : { ok: true, valor: f };
    }
    case "boolean": {
      const b = aBooleano(v);
      return b === null ? { ok: false, reason: "no_es_booleano" } : { ok: true, valor: b };
    }
    case "select": {
      const o = aOpcion(v, campo.options ?? []);
      return o === null ? { ok: false, reason: "opcion_invalida" } : { ok: true, valor: o };
    }
    case "text": {
      if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") return { ok: false, reason: "no_es_texto" };
      const s = String(v).trim();
      return s.length > TEXTO_MAX ? { ok: false, reason: "texto_largo" } : { ok: true, valor: s };
    }
  }
}

/**
 * Aplica el esquema a lo que llega. Las claves del esquema se guardan tipadas
 * a partir del valor CRUDO (A-6, auditoría 072-A: antes pasaba primero por
 * `normalizeFicha`, que recortaba a 500 y tiraba objetos en silencio, y el
 * campo nunca llegaba a reportarse); las inválidas se ignoran y se reportan
 * (sin 422: el LLM deriva y tirar un dato bueno cuesta una conversación). La
 * cadena vacía no borra ni se reporta (para borrar está `null`). Lo que no es
 * del esquema pasa tal cual: el llamador ya lo normalizó (las fichas B2B de
 * siempre siguen valiendo).
 */
export function aplicarEsquema(
  patch: Record<string, unknown>,
  campos: readonly FichaField[]
): { patch: Record<string, ValorFicha>; ignored: Ignorado[] } {
  const porClave = new Map(campos.map((c) => [c.key, c]));
  const out: Record<string, ValorFicha> = {};
  const ignored: Ignorado[] = [];
  for (const [key, valor] of Object.entries(patch)) {
    const campo = porClave.get(key);
    if (!campo) {
      out[key] = valor as ValorFicha;
      continue;
    }
    if (valor === undefined || (typeof valor === "string" && valor.trim() === "")) continue;
    const r = coaccionar(campo, valor);
    if (r.ok) out[key] = r.valor;
    else ignored.push({ key, reason: r.reason });
  }
  return { patch: out, ignored };
}

/** M-6 — Lee una clave PROPIA de la ficha (nunca algo heredado de `Object.prototype`). */
export function valorPropio(ficha: Record<string, unknown> | null | undefined, key: string): unknown {
  return ficha && Object.hasOwn(ficha, key) ? ficha[key] : undefined;
}

/** Los obligatorios que todavía no tienen valor, en el orden del esquema. */
export function faltantes(campos: readonly FichaField[], ficha: Record<string, unknown> | null | undefined): FichaField[] {
  return campos.filter((c) => {
    if (!c.required) return false;
    const v = valorPropio(ficha, c.key);
    return v === undefined || v === null || v === "";
  });
}
