import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { auditar } from "@/server/platform/auditoria";
import type { Actor } from "@/server/platform/invitaciones";

/**
 * 069 (US5, D5, FR-011) — Acceso de soporte de un Super-Admin a UN negocio.
 *
 * Por defecto la agencia no ve nada de un negocio (constitución I, Ley 1581).
 * Para dar soporte pide un acceso con nivel, motivo y caducidad:
 * - `lectura`: solo peticiones GET.
 * - `configuracion`: además, las mutaciones de las rutas que lo declaran
 *   (`withAuth(…, { soporte: "configuracion" })`): marca y apariencia,
 *   pipeline, agenda, perfil del agente y conocimiento. Nunca envío,
 *   contactos, equipo ni credenciales.
 * Todo queda en `platform_audit_log` y el dueño lo ve en Ajustes → Equipo.
 */

export const MAX_HORAS_SOPORTE = 8;

export const solicitudSoporteSchema = z
  .object({
    level: z.enum(["lectura", "configuracion"]),
    reason: z.string().trim().min(10, "motivo_corto").max(500),
    hours: z.number().min(0.25).max(MAX_HORAS_SOPORTE, "caducidad_maxima_8h"),
  })
  .strict();

export type SolicitudSoporte = z.infer<typeof solicitudSoporteSchema>;

export async function otorgarSoporte(
  actor: Actor,
  organizationId: string,
  solicitud: SolicitudSoporte,
  ahora: Date = new Date()
): Promise<{ id: string; expiresAt: Date }> {
  const id = newId("supportGrant");
  const expiresAt = new Date(ahora.getTime() + solicitud.hours * 3_600_000);
  await getDb().transaction(async (tx) => {
    await tx.insert(schema.supportGrant).values({
      id,
      organizationId,
      platformUserId: actor.userId,
      level: solicitud.level,
      reason: solicitud.reason,
      expiresAt,
    });
    await auditar(
      {
        actorUserId: actor.userId,
        action: "soporte_otorgado",
        organizationId,
        via: actor.via,
        tokenId: actor.tokenId,
        ip: actor.ip,
        // El motivo SÍ se audita: es lo que justifica el acceso ante el dueño.
        detail: { grantId: id, level: solicitud.level, reason: solicitud.reason, expiresAt: expiresAt.toISOString() },
      },
      tx
    );
  });
  return { id, expiresAt };
}

/** Revoca un acceso vigente (cualquier Super-Admin puede cerrarlo). */
export async function revocarSoporte(actor: Actor, grantId: string, ahora: Date = new Date()): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const filas = await tx
      .update(schema.supportGrant)
      .set({ revokedAt: ahora, revokedBy: actor.userId })
      .where(and(eq(schema.supportGrant.id, grantId), isNull(schema.supportGrant.revokedAt)))
      .returning({ organizationId: schema.supportGrant.organizationId });
    const fila = filas[0];
    if (!fila) return false;
    await auditar(
      {
        actorUserId: actor.userId,
        action: "soporte_revocado",
        organizationId: fila.organizationId,
        via: actor.via,
        ip: actor.ip,
        detail: { grantId },
      },
      tx
    );
    return true;
  });
}

export type AccesoSoporte = {
  id: string;
  organizationId: string;
  organizacion: string;
  actor: string;
  /** Quién lo abrió (id): solo esa persona puede entrar con él. */
  actorId: string;
  level: "lectura" | "configuracion";
  reason: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  vigente: boolean;
};

function publico(
  f: {
    id: string;
    organizationId: string;
    organizacion: string;
    actor: string;
    actorId: string;
    level: "lectura" | "configuracion";
    reason: string;
    createdAt: Date;
    expiresAt: Date;
    revokedAt: Date | null;
  },
  ahora: Date
): AccesoSoporte {
  return {
    ...f,
    createdAt: f.createdAt.toISOString(),
    expiresAt: f.expiresAt.toISOString(),
    revokedAt: f.revokedAt?.toISOString() ?? null,
    vigente: !f.revokedAt && f.expiresAt > ahora,
  };
}

const columnas = {
  id: schema.supportGrant.id,
  organizationId: schema.supportGrant.organizationId,
  organizacion: schema.organization.name,
  actor: schema.user.email,
  actorId: schema.supportGrant.platformUserId,
  level: schema.supportGrant.level,
  reason: schema.supportGrant.reason,
  createdAt: schema.supportGrant.createdAt,
  expiresAt: schema.supportGrant.expiresAt,
  revokedAt: schema.supportGrant.revokedAt,
};

/** Para el panel: los accesos de la plataforma, recientes primero. */
export async function listarAccesos(limite = 100, ahora: Date = new Date()): Promise<AccesoSoporte[]> {
  const filas = await getDb()
    .select(columnas)
    .from(schema.supportGrant)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.supportGrant.organizationId))
    .innerJoin(schema.user, eq(schema.user.id, schema.supportGrant.platformUserId))
    .orderBy(desc(schema.supportGrant.createdAt))
    .limit(limite);
  return filas.map((f) => publico(f, ahora));
}

/** Para el dueño: los accesos a SU negocio (A↛B por el filtro). */
export async function accesosDeOrganizacion(
  organizationId: string,
  limite = 50,
  ahora: Date = new Date()
): Promise<AccesoSoporte[]> {
  const filas = await getDb()
    .select(columnas)
    .from(schema.supportGrant)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.supportGrant.organizationId))
    .innerJoin(schema.user, eq(schema.user.id, schema.supportGrant.platformUserId))
    .where(eq(schema.supportGrant.organizationId, organizationId))
    .orderBy(desc(schema.supportGrant.createdAt))
    .limit(limite);
  return filas.map((f) => publico(f, ahora));
}

/** ¿Hay algún acceso vigente a esta organización? (para avisar en el panel) */
export async function hayAccesoVigente(organizationId: string, ahora: Date = new Date()): Promise<boolean> {
  const filas = await getDb()
    .select({ id: schema.supportGrant.id })
    .from(schema.supportGrant)
    .where(
      and(
        eq(schema.supportGrant.organizationId, organizationId),
        isNull(schema.supportGrant.revokedAt),
        gt(schema.supportGrant.expiresAt, ahora)
      )
    )
    .limit(1);
  return filas.length > 0;
}

/**
 * 069 (staging) — Los negocios a los que ESTA persona tiene hoy un acceso de
 * soporte vigente (para decidir si «Abrir negocio» entra o pide soporte).
 */
export async function organizacionesConSoporteVigente(userId: string, ahora: Date = new Date()): Promise<Set<string>> {
  const filas = await getDb()
    .select({ organizationId: schema.supportGrant.organizationId })
    .from(schema.supportGrant)
    .where(
      and(
        eq(schema.supportGrant.platformUserId, userId),
        isNull(schema.supportGrant.revokedAt),
        gt(schema.supportGrant.expiresAt, ahora)
      )
    );
  return new Set(filas.map((f) => f.organizationId));
}
