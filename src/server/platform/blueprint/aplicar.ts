import { eq, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import {
  blueprintSchema,
  type OrganizationBlueprint,
  type ResultadoBlueprint,
  type SeccionBlueprint,
} from "@/lib/platform/blueprint";
import { sembrarOrganizacion } from "@/server/auth/on-signup";
import { auditar } from "@/server/platform/auditoria";
import type { Actor } from "@/server/platform/invitaciones";
import { aplicarMetadata, type OrgParaBlueprint, type Tx } from "@/server/platform/blueprint/secciones/metadata";
import { aplicarModulos } from "@/server/platform/blueprint/secciones/modulos";
import { aplicarOwner } from "@/server/platform/blueprint/secciones/owner";

/**
 * 069 (D12) — EL servicio de aprovisionamiento. Panel, REST y MCP llaman
 * aquí y solo aquí: ninguna fachada tiene lógica propia.
 *
 * - Una transacción con bloqueo por organización: dos aplicaciones
 *   concurrentes se serializan y la segunda resulta `sin_cambios`.
 * - Declarativo e idempotente: aplicar dos veces lo mismo no cambia nada.
 * - `dryRun`: se ejecuta todo dentro de la transacción y se deshace; la
 *   respuesta es exactamente lo que habría pasado.
 * - Cada aplicación (también un `dryRun`) queda en `platform_audit_log` con
 *   secciones y conteos, sin textos del negocio.
 */

export class BlueprintError extends Error {
  constructor(
    public code: string,
    public status: number = 422,
    public issues: { path: string; message: string }[] = []
  ) {
    super(code);
    this.name = "BlueprintError";
  }
}

export type Objetivo = { crear: true } | { organizationId: string };

/** Secciones que este servicio aún no aplica (llegan con la US8). */
const SECCIONES_PENDIENTES: SeccionBlueprint[] = ["pipeline", "agent", "knowledge", "agenda"];

class Deshacer extends Error {
  constructor(public resultado: ResultadoBlueprint) {
    super("dry-run");
  }
}

export function validarBlueprint(entrada: unknown): OrganizationBlueprint {
  const r = blueprintSchema.safeParse(entrada);
  if (!r.success) {
    throw new BlueprintError(
      "blueprint_invalido",
      422,
      r.error.issues.map((i) => ({ path: i.path.join(".") || "(raíz)", message: i.message }))
    );
  }
  return r.data;
}

/** Busca por id o por slug. */
export async function buscarOrganizacion(idOrSlug: string): Promise<{ id: string; slug: string | null } | null> {
  const rows = await getDb()
    .select({ id: schema.organization.id, slug: schema.organization.slug })
    .from(schema.organization)
    .where(or(eq(schema.organization.id, idOrSlug), eq(schema.organization.slug, idOrSlug)))
    .limit(1);
  return rows[0] ?? null;
}

const columnasOrg = {
  id: schema.organization.id,
  name: schema.organization.name,
  slug: schema.organization.slug,
  metadata: schema.organization.metadata,
  modules: schema.organization.modules,
};

export async function aplicarBlueprint(
  actor: Actor,
  objetivo: Objetivo,
  entrada: unknown,
  opciones: { dryRun?: boolean } = {}
): Promise<ResultadoBlueprint> {
  const bp = validarBlueprint(entrada);
  const dryRun = opciones.dryRun === true;
  const pendientes = SECCIONES_PENDIENTES.filter((s) => bp[s] !== undefined);
  if (pendientes.length > 0) {
    throw new BlueprintError(
      "seccion_no_disponible",
      422,
      pendientes.map((s) => ({ path: s, message: "seccion_no_disponible" }))
    );
  }

  let resultado: ResultadoBlueprint;
  try {
    resultado = await getDb().transaction(async (tx) => {
      const { org, created } = await prepararOrganizacion(tx, actor, objetivo, bp);
      const r: ResultadoBlueprint = {
        organizationId: org.id,
        slug: org.slug ?? org.id,
        created,
        dryRun,
        sections: {},
        warnings: [],
      };
      const estado = (cambio: boolean) => (created ? "creada" : cambio ? "actualizada" : "sin_cambios");

      if (bp.organization || created) r.sections.organization = created ? "creada" : "sin_cambios";
      const meta = await aplicarMetadata(tx, org, bp, created);
      if (meta.organization) r.sections.organization = estado(true);
      if (bp.region) r.sections.region = estado(meta.region);
      if (bp.brand || created) r.sections.brand = estado(meta.brand);
      if (bp.modules) r.sections.modules = estado(await aplicarModulos(tx, org, bp.modules));
      if (bp.owner) {
        const o = await aplicarOwner(tx, actor, org, bp.owner, dryRun);
        r.sections.owner = o.cambio ? (created ? "creada" : "actualizada") : "sin_cambios";
        r.invitation = o.invitation;
      }

      if (dryRun) throw new Deshacer(r);
      await auditar(entradaDeAuditoria(actor, r), tx);
      return r;
    });
  } catch (err) {
    if (!(err instanceof Deshacer)) throw err;
    resultado = err.resultado;
    // Un plan también deja rastro (quién preguntó qué), sin la organización
    // si era nueva: la fila se deshizo con la transacción.
    await auditar({
      ...entradaDeAuditoria(actor, resultado),
      organizationId: resultado.created ? null : resultado.organizationId,
    });
  }
  return resultado;
}

function entradaDeAuditoria(actor: Actor, r: ResultadoBlueprint) {
  return {
    actorUserId: actor.userId,
    action: "blueprint_aplicado" as const,
    organizationId: r.organizationId,
    via: actor.via,
    tokenId: actor.tokenId,
    ip: actor.ip,
    detail: {
      slug: r.slug,
      created: r.created,
      dryRun: r.dryRun,
      sections: r.sections,
      warnings: r.warnings,
      invitation: r.invitation?.status ?? null,
    },
  };
}

async function prepararOrganizacion(
  tx: Tx,
  actor: Actor,
  objetivo: Objetivo,
  bp: OrganizationBlueprint
): Promise<{ org: OrgParaBlueprint; created: boolean }> {
  if ("crear" in objetivo) {
    const slug = bp.organization?.slug;
    const name = bp.organization?.name;
    if (!slug) throw new BlueprintError("slug_requerido", 422, [{ path: "organization.slug", message: "slug_requerido" }]);
    if (!name) throw new BlueprintError("nombre_requerido", 422, [{ path: "organization.name", message: "nombre_requerido" }]);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"org-slug:" + slug}))`);
    const existe = await tx
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .where(eq(schema.organization.slug, slug))
      .limit(1);
    if (existe.length > 0) {
      throw new BlueprintError("slug_en_uso", 409, [{ path: "organization.slug", message: "slug_en_uso" }]);
    }
    const id = newId("organization");
    await tx.insert(schema.organization).values({ id, name, slug, status: "activa" });
    await sembrarOrganizacion(tx, id);
    await auditar(
      {
        actorUserId: actor.userId,
        action: "organizacion_creada",
        organizationId: id,
        via: actor.via,
        tokenId: actor.tokenId,
        ip: actor.ip,
        detail: { slug },
      },
      tx
    );
    return { org: { id, name, slug, metadata: null, modules: null }, created: true };
  }

  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"org:" + objetivo.organizationId}))`);
  const rows = await tx
    .select(columnasOrg)
    .from(schema.organization)
    .where(eq(schema.organization.id, objetivo.organizationId))
    .limit(1);
  const org = rows[0];
  if (!org) throw new BlueprintError("organizacion_inexistente", 404);
  if (bp.organization?.slug !== undefined && bp.organization.slug !== org.slug) {
    throw new BlueprintError("slug_inmutable", 422, [{ path: "organization.slug", message: "slug_inmutable" }]);
  }
  return { org, created: false };
}
