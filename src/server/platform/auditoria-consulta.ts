import { and, desc, eq, lt, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { ACCIONES_AUDITORIA, type AccionAuditoria } from "@/server/platform/auditoria";

/**
 * Auditoría 069 (Fix-B) — Leer el rastro de la plataforma con filtros y
 * paginación por cursor (la fecha de la última entrada vista). Lo usan la
 * herramienta MCP `list_audit_log` y la pantalla `/platform/auditoria`.
 *
 * `detail` ya nace sin textos de clientes ni del negocio (ver `auditar`).
 */

export const VIAS_AUDITORIA = ["sesion", "api", "mcp"] as const;
export type ViaAuditoria = (typeof VIAS_AUDITORIA)[number];

export const LIMITE_AUDITORIA = { porDefecto: 50, maximo: 200 } as const;

export type FiltroAuditoria = {
  organizationId?: string | null;
  action?: string | null;
  via?: string | null;
  limit?: number;
  /**
   * La página siguiente: el `nextBefore` de la anterior (`<fecha>|<id>`). Un
   * ISO simple (versiones anteriores del MCP) sigue sirviendo: «antes de esa
   * fecha».
   */
  before?: string | null;
};

export type EntradaListada = {
  id: string;
  action: string;
  via: string;
  organizationId: string | null;
  actor: string | null;
  tokenId: string | null;
  detail: unknown;
  ip: string | null;
  createdAt: string;
};

export const esAccionAuditoria = (v: unknown): v is AccionAuditoria =>
  typeof v === "string" && (ACCIONES_AUDITORIA as readonly string[]).includes(v);
export const esViaAuditoria = (v: unknown): v is ViaAuditoria =>
  typeof v === "string" && (VIAS_AUDITORIA as readonly string[]).includes(v);

/** Pura: el límite pedido, acotado. */
export function limiteAuditoria(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseInt(v, 10) : Number.NaN;
  if (!Number.isFinite(n) || n < 1) return LIMITE_AUDITORIA.porDefecto;
  return Math.min(Math.floor(n), LIMITE_AUDITORIA.maximo);
}

const FECHA_CURSOR = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z?$/;

/**
 * Pura (auditoría final F-05): el cursor. Compuesto `(createdAt, id)` porque
 * varias filas nacen en la MISMA transacción con el mismo `created_at`
 * (crear un negocio escribe 3): cortar una página en medio de ellas con solo
 * la fecha perdía las demás. La fecha va con microsegundos (los de
 * PostgreSQL; un `Date` de JS solo tiene milisegundos).
 */
export function leerCursor(before: string | null | undefined): { fecha: string; id: string | null } | null {
  if (!before) return null;
  const corte = before.lastIndexOf("|");
  const fecha = corte >= 0 ? before.slice(0, corte) : before;
  const id = corte >= 0 ? before.slice(corte + 1) : null;
  if (!FECHA_CURSOR.test(fecha)) return null;
  if (id !== null && !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  return { fecha, id };
}

export async function listarAuditoria(
  f: FiltroAuditoria = {}
): Promise<{ entries: EntradaListada[]; nextBefore: string | null }> {
  const limit = limiteAuditoria(f.limit);
  const filtros: SQL[] = [];
  if (f.organizationId) filtros.push(eq(schema.platformAuditLog.organizationId, f.organizationId));
  if (esAccionAuditoria(f.action)) filtros.push(eq(schema.platformAuditLog.action, f.action));
  if (esViaAuditoria(f.via)) filtros.push(eq(schema.platformAuditLog.via, f.via));
  const cursor = leerCursor(f.before);
  if (cursor) {
    const fecha = sql`${cursor.fecha}::timestamp`;
    filtros.push(
      cursor.id === null
        ? sql`${schema.platformAuditLog.createdAt} < ${fecha}`
        : (or(
            sql`${schema.platformAuditLog.createdAt} < ${fecha}`,
            and(sql`${schema.platformAuditLog.createdAt} = ${fecha}`, lt(schema.platformAuditLog.id, cursor.id))
          ) as SQL)
    );
  }
  const filas = await getDb()
    .select({
      id: schema.platformAuditLog.id,
      action: schema.platformAuditLog.action,
      via: schema.platformAuditLog.via,
      organizationId: schema.platformAuditLog.organizationId,
      tokenId: schema.platformAuditLog.tokenId,
      detail: schema.platformAuditLog.detail,
      ip: schema.platformAuditLog.ip,
      createdAt: schema.platformAuditLog.createdAt,
      // La fecha exacta (microsegundos) para el cursor.
      marca: sql<string>`to_char(${schema.platformAuditLog.createdAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US')`,
      actor: schema.user.email,
    })
    .from(schema.platformAuditLog)
    .leftJoin(schema.user, eq(schema.user.id, schema.platformAuditLog.actorUserId))
    .where(filtros.length ? and(...filtros) : undefined)
    .orderBy(desc(schema.platformAuditLog.createdAt), desc(schema.platformAuditLog.id))
    .limit(limit + 1);
  const pagina = filas.slice(0, limit);
  return {
    entries: pagina.map((e) => ({
      id: e.id,
      action: e.action,
      via: e.via,
      organizationId: e.organizationId,
      actor: e.actor ?? null,
      tokenId: e.tokenId ?? null,
      detail: e.detail,
      ip: e.ip ?? null,
      createdAt: e.createdAt.toISOString(),
    })),
    nextBefore: filas.length > limit ? cursorDe(pagina[pagina.length - 1]) : null,
  };
}

/** El cursor de una fila: su fecha exacta y su id. */
function cursorDe(fila: { id: string; createdAt: Date; marca?: string | null } | undefined): string | null {
  if (!fila) return null;
  return `${fila.marca ?? fila.createdAt.toISOString()}|${fila.id}`;
}
