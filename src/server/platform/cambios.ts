import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * 069 (D12, US5-7) — Lo que la plataforma hizo en UN negocio, para que su
 * dueño lo vea en Ajustes → Equipo. Solo acciones de Super-Admins (las
 * invitaciones que el propio owner genera no son «de la plataforma») y nunca
 * los planes (`dryRun`), que no cambiaron nada. El acceso de soporte se suma
 * en la US5.
 */

const ACCIONES = [
  "organizacion_creada",
  "blueprint_aplicado",
  "organizacion_suspendida",
  "organizacion_reactivada",
  "invitacion_creada",
  "invitacion_revocada",
  "soporte_otorgado",
  "soporte_revocado",
] as const;

export type CambioPlataforma = {
  id: string;
  action: string;
  via: string;
  actor: string;
  createdAt: string;
  sections: string[];
};

export async function cambiosDeLaPlataforma(organizationId: string, limite = 50): Promise<CambioPlataforma[]> {
  const filas = await getDb()
    .select({
      id: schema.platformAuditLog.id,
      action: schema.platformAuditLog.action,
      via: schema.platformAuditLog.via,
      detail: schema.platformAuditLog.detail,
      createdAt: schema.platformAuditLog.createdAt,
      actor: schema.user.email,
    })
    .from(schema.platformAuditLog)
    .innerJoin(schema.platformAdmin, eq(schema.platformAdmin.userId, schema.platformAuditLog.actorUserId))
    .innerJoin(schema.user, eq(schema.user.id, schema.platformAuditLog.actorUserId))
    .where(
      and(
        eq(schema.platformAuditLog.organizationId, organizationId),
        inArray(schema.platformAuditLog.action, [...ACCIONES])
      )
    )
    .orderBy(desc(schema.platformAuditLog.createdAt))
    .limit(limite * 2);
  return filas
    .filter((f) => (f.detail as { dryRun?: boolean }).dryRun !== true)
    .slice(0, limite)
    .map((f) => {
      const sections = (f.detail as { sections?: Record<string, string> }).sections ?? {};
      return {
        id: f.id,
        action: f.action,
        via: f.via,
        actor: f.actor,
        createdAt: f.createdAt.toISOString(),
        sections: Object.entries(sections)
          .filter(([, estado]) => estado !== "sin_cambios")
          .map(([s]) => s),
      };
    });
}
