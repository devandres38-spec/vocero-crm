import { eq } from "drizzle-orm";
import { z } from "zod";
import { puedeConfigurar } from "@/lib/auth/roles";
import { getDb, schema } from "@/lib/db";
import { aFichaSchema, leerFichaFields, TIPOS_CAMPO, type FichaField, type FichaSchema, type TipoCampo } from "@/lib/ficha-campos";

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

/**
 * M-8 (auditoría 072-A) — Quién edita los campos: la MISMA regla para el
 * `puedeEditar` del GET (lo que habilita la UI) y para el PUT. Un acceso de
 * soporte solo lee: la ruta no está entre las de soporte de configuración
 * (decisión de producto, Ley 1581); la agencia los ajusta por el Blueprint.
 */
export function puedeEditarFicha(session: Parameters<typeof puedeConfigurar>[0] & { via?: string }): boolean {
  return session.via !== "soporte" && puedeConfigurar(session);
}

/** Lo que viaja al cerebro en el contexto; `null` = sin esquema. */
export async function fichaSchemaDe(organizationId: string): Promise<FichaSchema | null> {
  return aFichaSchema(await fichaFieldsDe(organizationId));
}

/**
 * Puro: la regla de la clave inmutable. Un campo que ya existía no cambia de
 * tipo (lo guardado dejaría de encajar en silencio); para otro tipo, otra
 * clave. Devuelve las claves que lo violan.
 *
 * A-4 (auditoría 072-A) — `retirados` son los tipos de los campos que se
 * quitaron: sus valores siguen en `contact.ficha`, así que quitar `invitados`
 * (número) y recrearlo como fecha en otro guardado es el mismo cambio de tipo
 * hecho en dos pasos, y también se rechaza.
 */
export function tiposCambiados(
  antes: readonly FichaField[],
  despues: readonly FichaField[],
  retirados: Readonly<Record<string, TipoCampo>> = {}
): string[] {
  const previo = new Map<string, TipoCampo>(Object.entries(retirados));
  for (const f of antes) previo.set(f.key, f.type);
  return despues.filter((f) => previo.has(f.key) && previo.get(f.key) !== f.type).map((f) => f.key);
}

const TOPE_RETIRADOS = 100;
const retiradosSchema = z.record(z.string(), z.enum(TIPOS_CAMPO));

/** Los tipos de los campos quitados (memoria de la regla de inmutabilidad). Tolera basura. */
export function leerRetirados(raw: unknown): Record<string, TipoCampo> {
  if (!raw || typeof raw !== "object") return {};
  const r = retiradosSchema.safeParse((raw as { retirados?: unknown }).retirados);
  return r.success ? r.data : {};
}

/** Puro: la memoria tras guardar — se suman los quitados; lo que vuelve con su tipo sale. */
export function retiradosTras(
  antes: readonly FichaField[],
  despues: readonly FichaField[],
  retirados: Readonly<Record<string, TipoCampo>>
): Record<string, TipoCampo> {
  const out: Record<string, TipoCampo> = { ...retirados };
  const quedan = new Set(despues.map((f) => f.key));
  for (const f of antes) if (!quedan.has(f.key)) out[f.key] = f.type;
  for (const k of quedan) delete out[k];
  // Acotada (la columna tiene un CHECK de tamaño): se olvidan las más viejas.
  const entradas = Object.entries(out);
  return entradas.length > TOPE_RETIRADOS ? Object.fromEntries(entradas.slice(-TOPE_RETIRADOS)) : out;
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

type DbFicha = Pick<ReturnType<typeof getDb>, "select" | "update">;

/**
 * Reemplaza el esquema completo del negocio (`[]` = quitarlo). La única puerta
 * de escritura: la usan Ajustes → Ficha y el Blueprint. Quitar un campo NO
 * borra sus valores en las fichas: pasan a «Otros datos».
 *
 * A-4 (auditoría 072-A) — Leer, validar y escribir van en UNA transacción con
 * la fila de la organización bloqueada (`FOR UPDATE`): dos guardados a la vez
 * no pueden validar contra el mismo «antes» y colarse un cambio de tipo. Con
 * `tx` (el Blueprint ya abrió la suya) se usa esa; sin ella, se abre una.
 */
export async function guardarFichaFields(
  organizationId: string,
  fields: FichaField[],
  tx?: DbFicha
): Promise<ResultadoGuardarFicha> {
  if (tx) return guardarEn(tx, organizationId, fields);
  return getDb().transaction((t) => guardarEn(t, organizationId, fields));
}

async function guardarEn(db: DbFicha, organizationId: string, fields: FichaField[]): Promise<ResultadoGuardarFicha> {
  const rows = await db
    .select({ fichaFields: schema.organization.fichaFields })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .for("update")
    .limit(1);
  const raw = rows[0]?.fichaFields ?? null;
  const antes = leerFichaFields(raw);
  const retirados = leerRetirados(raw);
  const claves = tiposCambiados(antes, fields, retirados);
  if (claves.length > 0) return { ok: false, error: "tipo_inmutable", claves };
  const limpios = fields.map(canonico);
  if (mismosCampos(antes, limpios)) return { ok: true, cambio: false, fields: limpios };
  const memoria = retiradosTras(antes, limpios, retirados);
  const hayMemoria = Object.keys(memoria).length > 0;
  await db
    .update(schema.organization)
    .set({
      fichaFields:
        limpios.length > 0 || hayMemoria
          ? { version: 1, fields: limpios, ...(hayMemoria ? { retirados: memoria } : {}) }
          : null,
    })
    .where(eq(schema.organization.id, organizationId));
  return { ok: true, cambio: true, fields: limpios };
}
