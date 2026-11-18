import { and, desc, eq, lt, type SQL } from "drizzle-orm";
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
  /** ISO: solo entradas anteriores a esta fecha (la página siguiente). */
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

export async function listarAuditoria(
  f: FiltroAuditoria = {}
): Promise<{ entries: EntradaListada[]; nextBefore: string | null }> {
  const limit = limiteAuditoria(f.limit);
  const filtros: SQL[] = [];
  if (f.organizationId) filtros.push(eq(schema.platformAuditLog.organizationId, f.organizationId));
  if (esAccionAuditoria(f.action)) filtros.push(eq(schema.platformAuditLog.action, f.action));
  if (esViaAuditoria(f.via)) filtros.push(eq(schema.platformAuditLog.via, f.via));
  if (f.before) {
    const antes = new Date(f.before);
    if (!Number.isNaN(antes.getTime())) filtros.push(lt(schema.platformAuditLog.createdAt, antes));
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
      actor: schema.user.email,
    })
    .from(schema.platformAuditLog)
    .leftJoin(schema.user, eq(schema.user.id, schema.platformAuditLog.actorUserId))
    .where(filtros.length ? and(...filtros) : undefined)
    .orderBy(desc(schema.platformAuditLog.createdAt))
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
    nextBefore: filas.length > limit ? (pagina[pagina.length - 1]?.createdAt.toISOString() ?? null) : null,
  };
}
