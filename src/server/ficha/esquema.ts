import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { aFichaSchema, leerFichaFields, type FichaField, type FichaSchema } from "@/lib/ficha-campos";

/**
 * 072 (D9) — El esquema de la ficha de UN negocio, leído de su organización.
 * Basura en la columna = sin esquema (comportamiento de 2.11.0). La lógica
 * pura (tipos, coerción, faltantes) vive en `src/lib/ficha-campos.ts`.
 */
export async function fichaFieldsDe(
  organizationId: string,
  db: Pick<ReturnType<typeof getDb>, "select"> = getDb()
): Promise<FichaField[]> {
  const rows = await db
    .select({ fichaFields: schema.organization.fichaFields })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return leerFichaFields(rows[0]?.fichaFields ?? null);
}

/** Lo que viaja al cerebro en el contexto; `null` = sin esquema. */
export async function fichaSchemaDe(organizationId: string): Promise<FichaSchema | null> {
  return aFichaSchema(await fichaFieldsDe(organizationId));
}

/**
 * Puro: la regla de la clave inmutable. Un campo que ya existía no cambia de
 * tipo (lo guardado dejaría de encajar en silencio); para otro tipo, otra
 * clave. Devuelve las claves que lo violan.
 */
export function tiposCambiados(antes: readonly FichaField[], despues: readonly FichaField[]): string[] {
  const previo = new Map(antes.map((f) => [f.key, f.type]));
  return despues.filter((f) => previo.has(f.key) && previo.get(f.key) !== f.type).map((f) => f.key);
}

export type ResultadoGuardarFicha =
  | { ok: true; cambio: boolean; fields: FichaField[] }
  | { ok: false; error: "tipo_inmutable"; claves: string[] };

/** Puro: ¿el esquema nuevo es el mismo que el guardado? (idempotencia del Blueprint). */
export function mismosCampos(a: readonly FichaField[], b: readonly FichaField[]): boolean {
  return JSON.stringify(a.map(canonico)) === JSON.stringify(b.map(canonico));
}

function canonico(f: FichaField): FichaField {
  return {
    key: f.key,
    label: f.label,
    type: f.type,
    ...(f.options ? { options: [...f.options] } : {}),
    ...(f.required ? { required: true } : {}),
    ...(f.description ? { description: f.description } : {}),
  };
}

/**
 * Reemplaza el esquema completo del negocio (`[]` = quitarlo). La única puerta
 * de escritura: la usan Ajustes → Ficha y el Blueprint. Quitar un campo NO
 * borra sus valores en las fichas: pasan a «Otros datos».
 */
export async function guardarFichaFields(
  organizationId: string,
  fields: FichaField[],
  db: Pick<ReturnType<typeof getDb>, "select" | "update"> = getDb()
): Promise<ResultadoGuardarFicha> {
  const antes = await fichaFieldsDe(organizationId, db);
  const claves = tiposCambiados(antes, fields);
  if (claves.length > 0) return { ok: false, error: "tipo_inmutable", claves };
  const limpios = fields.map(canonico);
  if (mismosCampos(antes, limpios)) return { ok: true, cambio: false, fields: limpios };
  await db
    .update(schema.organization)
    .set({ fichaFields: limpios.length > 0 ? { version: 1, fields: limpios } : null })
    .where(eq(schema.organization.id, organizationId));
  return { ok: true, cambio: true, fields: limpios };
}
