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
/** `notas` es del bot (siempre existe en `update_ficha`). */
export const CLAVES_RESERVADAS: readonly string[] = ["notas"];

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
