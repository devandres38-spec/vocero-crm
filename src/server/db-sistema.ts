import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { comoSistema, validarNegocio } from "@/lib/db/contexto";

/**
 * 075 (D5 de la spec) — Las funciones `SECURITY DEFINER` de la migración
 * 0033, tipadas. SOLO devuelven ids, un rol o conteos: es lo que se puede
 * saber antes de entrar a un negocio (la sesión, el webhook entrante, el
 * trabajo pendiente de los procesos de fondo). Todo lo demás se lee y se
 * escribe dentro de `conNegocio`, con RLS.
 *
 * Cada llamada corre en `comoSistema`: sin negocio fijado.
 */

/**
 * Una fecha como `timestamp` (UTC, el marco del proyecto). Un `Date` viajaría
 * como `timestamptz`, y Postgres no lo convierte solo al buscar la función.
 */
function marca(fecha: Date) {
  return sql`${fecha.toISOString()}::timestamp`;
}

/** Un arreglo de ids como literal de Postgres (Drizzle expandiría un arreglo en una lista). */
function arregloDeIds(ids: readonly string[]) {
  for (const id of ids) validarNegocio(id);
  return sql`${`{${ids.join(",")}}`}::text[]`;
}

async function filas<T>(motivo: string, consulta: ReturnType<typeof sql>): Promise<T[]> {
  return comoSistema(motivo, async () => {
    const r = await getDb().execute(consulta);
    return r as unknown as T[];
  });
}

/** El negocio y el rol de un usuario (su primera membresía, con orden fijo). */
export async function membresiaDe(
  userId: string
): Promise<{ organizationId: string; role: string } | null> {
  const [f] = await filas<{ organization_id: string; role: string }>(
    "sesion",
    sql`select organization_id, role from vocero_membresia(${userId}::text)`
  );
  return f ? { organizationId: f.organization_id, role: f.role } : null;
}

export async function organizacionExisteSistema(organizationId: string): Promise<boolean> {
  const [f] = await filas<{ existe: boolean }>(
    "cerebro",
    sql`select vocero_organizacion_existe(${organizationId}::text) as existe`
  );
  return f?.existe === true;
}

export async function hastaDosOrganizacionesSistema(): Promise<string[]> {
  const [f] = await filas<{ ids: string[] | null }>(
    "cerebro",
    sql`select vocero_hasta_dos_organizaciones() as ids`
  );
  return f?.ids ?? [];
}

/** Todos los negocios (ids): para la retención, el arranque y los mocks. */
export async function todasLasOrganizaciones(): Promise<string[]> {
  const r = await filas<{ id: string }>("recorrido", sql`select vocero_organizaciones() as id`);
  return r.map((f) => f.id);
}

export type TipoDeCanal =
  | "phone_number_id"
  | "waba_id"
  | "ig_user_id"
  | "page_id"
  | "zernio:instagram"
  | "zernio:messenger"
  | "zernio:tiktok";

/** El negocio de un webhook entrante, por la clave que trae. */
export async function negocioPorCanal(tipo: TipoDeCanal, clave: string): Promise<string | null> {
  const [f] = await filas<{ org: string | null }>(
    "webhook",
    sql`select vocero_negocio_por_canal(${tipo}::text, ${clave}::text) as org`
  );
  return f?.org ?? null;
}

export type IdYNegocio = { id: string; organizationId: string };

export async function despachosVencidos(
  ahora: Date,
  limite: number,
  excluir: readonly string[]
): Promise<IdYNegocio[]> {
  const r = await filas<{ id: string; organization_id: string }>(
    "despacho",
    sql`select id, organization_id from vocero_despachos_vencidos(${marca(ahora)}, ${limite}::int, ${arregloDeIds(excluir)})`
  );
  return r.map((f) => ({ id: f.id, organizationId: f.organization_id }));
}

export async function eventosPendientes(ahora: Date, limite: number): Promise<IdYNegocio[]> {
  const r = await filas<{ id: string; organization_id: string }>(
    "webhooks",
    sql`select id, organization_id from vocero_eventos_pendientes(${marca(ahora)}, ${limite}::int)`
  );
  return r.map((f) => ({ id: f.id, organizationId: f.organization_id }));
}

export async function negociosConEventosViejos(
  corteProcesado: Date,
  corteAgotado: Date
): Promise<string[]> {
  const r = await filas<{ id: string }>(
    "webhooks",
    sql`select vocero_negocios_con_eventos_viejos(${marca(corteProcesado)}, ${marca(corteAgotado)}) as id`
  );
  return r.map((f) => f.id);
}

export async function conteoDeWebhooks(): Promise<{ pendientes: number; agotados: number }> {
  const [f] = await filas<{ pendientes: string | number; agotados: string | number }>(
    "salud",
    sql`select pendientes, agotados from vocero_conteo_webhooks()`
  );
  return { pendientes: Number(f?.pendientes ?? 0), agotados: Number(f?.agotados ?? 0) };
}

export async function negociosConOlvidos(ahora: Date): Promise<string[]> {
  const r = await filas<{ id: string }>(
    "olvidos",
    sql`select vocero_negocios_con_olvidos(${marca(ahora)}) as id`
  );
  return r.map((f) => f.id);
}

export async function negociosConAvisos(): Promise<string[]> {
  const r = await filas<{ id: string }>("avisos", sql`select vocero_negocios_con_avisos() as id`);
  return r.map((f) => f.id);
}

export async function slugsOcupados(base: string): Promise<string[]> {
  const [f] = await filas<{ slugs: string[] | null }>(
    "alta",
    sql`select vocero_slugs_ocupados(${base}::text) as slugs`
  );
  return f?.slugs ?? [];
}
