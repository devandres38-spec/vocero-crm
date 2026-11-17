import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { dominioBase, tenancy } from "@/lib/tenancy";
import { techoDeInstancia } from "@/server/modulos/efectivos";
import { resolveMembership } from "@/server/auth/on-signup";
import type { DepsContexto, GrantSoporte, OrgFila } from "@/server/tenant/contexto";
import { hostDeHeaders, slugDelHost } from "@/server/tenant/host";

/** 069 — Las consultas reales del resolvedor (`contexto.ts` es puro). */

const columnasOrg = {
  id: schema.organization.id,
  slug: schema.organization.slug,
  status: schema.organization.status,
  modules: schema.organization.modules,
};

export async function orgPorSlug(slug: string): Promise<OrgFila | null> {
  const rows = await getDb()
    .select(columnasOrg)
    .from(schema.organization)
    .where(eq(schema.organization.slug, slug))
    .limit(1);
  return rows[0] ?? null;
}

export async function orgPorId(id: string): Promise<OrgFila | null> {
  const rows = await getDb()
    .select(columnasOrg)
    .from(schema.organization)
    .where(eq(schema.organization.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function membresia(
  userId: string,
  organizationId: string
): Promise<{ role: string } | null> {
  const rows = await getDb()
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(and(eq(schema.member.userId, userId), eq(schema.member.organizationId, organizationId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function esSuperAdmin(userId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ userId: schema.platformAdmin.userId })
    .from(schema.platformAdmin)
    .where(eq(schema.platformAdmin.userId, userId))
    .limit(1);
  return rows.length > 0;
}

/** El acceso de soporte vigente (no revocado, no vencido) más reciente. */
export async function grantVigente(
  userId: string,
  organizationId: string,
  ahora: Date = new Date()
): Promise<GrantSoporte | null> {
  const rows = await getDb()
    .select({
      id: schema.supportGrant.id,
      level: schema.supportGrant.level,
      expiresAt: schema.supportGrant.expiresAt,
    })
    .from(schema.supportGrant)
    .where(
      and(
        eq(schema.supportGrant.platformUserId, userId),
        eq(schema.supportGrant.organizationId, organizationId),
        isNull(schema.supportGrant.revokedAt),
        gt(schema.supportGrant.expiresAt, ahora)
      )
    )
    .orderBy(desc(schema.supportGrant.expiresAt))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Las organizaciones de un usuario. Para el selector de empresas y para la
 * organización activa al iniciar sesión cuando hay UNA (la única, no «la
 * primera»).
 */
export async function membresiasDe(
  userId: string
): Promise<{ organizationId: string; role: string; name: string; slug: string | null; status: string }[]> {
  return getDb()
    .select({
      organizationId: schema.member.organizationId,
      role: schema.member.role,
      name: schema.organization.name,
      slug: schema.organization.slug,
      status: schema.organization.status,
    })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
    .where(eq(schema.member.userId, userId))
    .orderBy(schema.organization.name);
}

/** Dependencias reales del resolvedor para unos headers dados. */
export function depsReales(
  h: Pick<Headers, "get">,
  sesion: DepsContexto["sesion"]
): DepsContexto {
  return {
    modo: tenancy(),
    base: dominioBase(),
    host: hostDeHeaders(h),
    sesion,
    techo: techoDeInstancia,
    membresiaUnicaInstancia: resolveMembership,
    orgPorSlug,
    orgPorId,
    membresia,
    esSuperAdmin,
    grantVigente: (u, o) => grantVigente(u, o),
  };
}

/**
 * La organización del host, sin sesión (marca del login, manifest, favicon).
 * Solo en `multi`; null en el dominio raíz o si no existe. Una suspendida no
 * presta su marca: muestra la de plataforma.
 */
export async function organizacionPorHost(h: Pick<Headers, "get">): Promise<OrgFila | null> {
  if (tenancy() !== "multi") return null;
  const info = slugDelHost(hostDeHeaders(h), dominioBase());
  if (info.tipo !== "organizacion") return null;
  const org = await orgPorSlug(info.slug);
  return org && org.status === "activa" ? org : null;
}
