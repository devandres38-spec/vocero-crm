import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";

/**
 * 069 — Rastro de toda acción de plataforma (Ley 1581, constitución I). Una
 * entrada por acción; `detail` lleva nombres de campos y conteos, NUNCA
 * contenido de clientes, textos del conocimiento ni credenciales.
 */

export type AccionAuditoria =
  | "admin_registrado"
  | "organizacion_creada"
  | "organizacion_suspendida"
  | "organizacion_reactivada"
  | "modulos_cambiados"
  | "invitacion_creada"
  | "invitacion_revocada"
  | "invitacion_aceptada"
  | "blueprint_aplicado"
  | "token_creado"
  | "token_revocado"
  | "token_rechazado"
  | "soporte_otorgado"
  | "soporte_revocado"
  | "soporte_peticion"
  | "acceso_denegado";

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
