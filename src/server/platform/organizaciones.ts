import { and, count, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { normalizeBranding, type Branding } from "@/lib/branding";
import { auditar } from "@/server/platform/auditoria";
import { leerMetadata, regionGuardada, type RegionGuardada } from "@/server/platform/blueprint/secciones/metadata";
import type { Actor } from "@/server/platform/invitaciones";
import { modulosEfectivos, techoDeInstancia, type ModulosEfectivos } from "@/server/modulos/efectivos";

/**
 * 069 (US2) — Administración de organizaciones desde la plataforma. Solo
 * datos de configuración y conteos: nada de conversaciones ni contactos
 * (constitución I: la agencia no ve datos de clientes sin acceso de soporte).
 */

export type ResumenOrganizacion = {
  id: string;
  slug: string | null;
  name: string;
  status: "activa" | "suspendida";
  createdAt: string;
  suspendedAt: string | null;
  miembros: number;
};

export async function listarOrganizaciones(): Promise<ResumenOrganizacion[]> {
  const db = getDb();
  const filas = await db
    .select({
      id: schema.organization.id,
      slug: schema.organization.slug,
      name: schema.organization.name,
      status: schema.organization.status,
      createdAt: schema.organization.createdAt,
      suspendedAt: schema.organization.suspendedAt,
    })
    .from(schema.organization)
    .orderBy(desc(schema.organization.createdAt));
  const conteos = await db
    .select({ organizationId: schema.member.organizationId, n: count() })
    .from(schema.member)
    .groupBy(schema.member.organizationId);
  const porOrg = new Map(conteos.map((c) => [c.organizationId, c.n]));
  return filas.map((f) => ({
    ...f,
    createdAt: f.createdAt.toISOString(),
    suspendedAt: f.suspendedAt?.toISOString() ?? null,
    miembros: porOrg.get(f.id) ?? 0,
  }));
}

export type DetalleOrganizacion = ResumenOrganizacion & {
  region: RegionGuardada;
  branding: Branding;
  modulosGuardados: unknown;
  modulos: ModulosEfectivos;
  equipo: { email: string; name: string; role: string }[];
  invitaciones: { id: string; email: string; role: string | null; expiresAt: string }[];
};

export async function detalleOrganizacion(organizationId: string): Promise<DetalleOrganizacion | null> {
  const db = getDb();
  const [org] = await db
    .select()
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  if (!org) return null;
  const meta = leerMetadata(org.metadata);
  const equipo = await db
    .select({ email: schema.user.email, name: schema.user.name, role: schema.member.role })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(eq(schema.member.organizationId, org.id));
  const invitaciones = await db
    .select({
      id: schema.invitation.id,
      email: schema.invitation.email,
      role: schema.invitation.role,
      expiresAt: schema.invitation.expiresAt,
    })
    .from(schema.invitation)
    .where(and(eq(schema.invitation.organizationId, org.id), eq(schema.invitation.status, "pending")));
  return {
    id: org.id,
    slug: org.slug,
    name: org.name,
    status: org.status,
    createdAt: org.createdAt.toISOString(),
    suspendedAt: org.suspendedAt?.toISOString() ?? null,
    miembros: equipo.length,
    region: regionGuardada(meta),
    branding: normalizeBranding((meta.branding as Partial<Branding> | undefined) ?? null),
    modulosGuardados: org.modules ?? null,
    modulos: modulosEfectivos(techoDeInstancia(), org.modules),
    equipo,
    invitaciones: invitaciones.map((i) => ({ ...i, expiresAt: i.expiresAt.toISOString() })),
  };
}

/**
 * Suspende o reactiva. Idempotente: suspender una suspendida no cambia nada
 * (ni la fecha) y devuelve `false`.
 */
export async function cambiarEstado(
  actor: Actor,
  organizationId: string,
  status: "activa" | "suspendida"
): Promise<boolean | null> {
  return getDb().transaction(async (tx) => {
    const [org] = await tx
      .select({ status: schema.organization.status })
      .from(schema.organization)
      .where(eq(schema.organization.id, organizationId))
      .limit(1);
    if (!org) return null;
    if (org.status === status) return false;
    await tx
      .update(schema.organization)
      .set({ status, suspendedAt: status === "suspendida" ? new Date() : null })
      .where(eq(schema.organization.id, organizationId));
    await auditar(
      {
        actorUserId: actor.userId,
        action: status === "suspendida" ? "organizacion_suspendida" : "organizacion_reactivada",
        organizationId,
        via: actor.via,
        tokenId: actor.tokenId,
        ip: actor.ip,
      },
      tx
    );
    return true;
  });
}
