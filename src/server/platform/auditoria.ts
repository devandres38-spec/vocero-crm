import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";

/**
 * 069 — Rastro de toda acción de plataforma (Ley 1581, constitución I). Una
 * entrada por acción; `detail` lleva nombres de campos y conteos, NUNCA
 * contenido de clientes, textos del conocimiento ni credenciales.
 */

/** Todas las acciones auditables (el filtro de /platform/auditoria las lista). */
export const ACCIONES_AUDITORIA = [
  "admin_registrado",
  "organizacion_creada",
  "organizacion_suspendida",
  "organizacion_reactivada",
  "modulos_cambiados",
  "invitacion_creada",
  "invitacion_revocada",
  "invitacion_aceptada",
  "blueprint_aplicado",
  "blueprint_exportado",
  "icono_cambiado",
  "pase_emitido",
  "pase_canjeado",
  "token_creado",
  "token_revocado",
  "token_rechazado",
  "soporte_otorgado",
  "soporte_revocado",
  "soporte_peticion",
  "acceso_denegado",
  // 070 — despliegues de cerebro
  "cerebro_creado",
  "cerebro_actualizado",
  "cerebro_secreto_rotado",
  "cerebro_pausado",
  "cerebro_reactivado",
  "cerebro_borrado",
  "cerebro_asignado",
  "cerebro_probado",
] as const;

export type AccionAuditoria = (typeof ACCIONES_AUDITORIA)[number];

export type EntradaAuditoria = {
  actorUserId: string;
  action: AccionAuditoria;
  organizationId?: string | null;
  via?: "sesion" | "api" | "mcp";
  tokenId?: string | null;
  detail?: Record<string, unknown>;
  ip?: string | null;
};

type Escritor = Pick<ReturnType<typeof getDb>, "insert">;

/**
 * Escribe la entrada. Dentro de una transacción, pasa `tx`: la acción y su
 * rastro se confirman (o se descartan) juntas.
 */
export async function auditar(entrada: EntradaAuditoria, db: Escritor = getDb()): Promise<void> {
  await db.insert(schema.platformAuditLog).values({
    id: newId("platformAudit"),
    actorUserId: entrada.actorUserId,
    organizationId: entrada.organizationId ?? null,
    via: entrada.via ?? "sesion",
    tokenId: entrada.tokenId ?? null,
    action: entrada.action,
    detail: entrada.detail ?? {},
    ip: entrada.ip ?? null,
  });
}
