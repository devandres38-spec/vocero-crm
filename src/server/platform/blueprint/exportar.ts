import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { normalizeBranding, type Branding } from "@/lib/branding";
import { esClaveHerramienta, ROLES, type ClaveHerramienta, type ClaveRol } from "@/lib/agent-roles";
import type { OrganizationBlueprint } from "@/lib/platform/blueprint";
import { getSettings } from "@/server/agenda/settings";
import { leerMetadata, regionGuardada } from "./secciones/metadata";

type Entrada = NonNullable<OrganizationBlueprint["knowledge"]>["entries"][number];

/**
 * 069 (D12) — El Blueprint VIGENTE de una organización: el inverso exacto de
 * `aplicarBlueprint`. Aplicar lo que devuelve no cambia nada (lo prueba
 * `blueprint-aplicar.test.ts`). Sin `owner` (las invitaciones no son
 * configuración) ni nada que no exista: una región nunca guardada no se
 * exporta, para no fijar como propia la de la instancia.
 *
 * Expone instrucciones y conocimiento del negocio —configuración, no datos de
 * clientes—; queda auditado como lectura de plataforma en la ruta que lo sirve.
 */
export async function exportarBlueprint(organizationId: string): Promise<OrganizationBlueprint | null> {
  const db = getDb();
  const [org] = await db
    .select()
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  if (!org) return null;
  const meta = leerMetadata(org.metadata);
  const region = regionGuardada(meta);
  const branding = normalizeBranding((meta.branding as Partial<Branding> | undefined) ?? null);

  const [etapas, [perfil], kb, calendario] = await Promise.all([
    db
      .select({ name: schema.pipelineStage.name, kind: schema.pipelineStage.kind })
      .from(schema.pipelineStage)
      .where(eq(schema.pipelineStage.organizationId, organizationId))
      .orderBy(asc(schema.pipelineStage.position)),
    db.select().from(schema.agentProfile).where(eq(schema.agentProfile.organizationId, organizationId)).limit(1),
    db
      .select()
      .from(schema.kbEntry)
      .where(eq(schema.kbEntry.organizationId, organizationId))
      .orderBy(asc(schema.kbEntry.createdAt)),
    db
      .select({ id: schema.calendarSettings.id })
      .from(schema.calendarSettings)
      .where(eq(schema.calendarSettings.organizationId, organizationId))
      .limit(1),
  ]);

  const bp: OrganizationBlueprint = {
    version: 1,
    organization: { ...(org.slug ? { slug: org.slug } : {}), name: org.name },
    brand: { name: branding.name, accent: branding.accent, currency: branding.currency },
  };
  if (Object.keys(region).length > 0) bp.region = region;
  if (org.modules) bp.modules = org.modules as OrganizationBlueprint["modules"];

  const abiertas = etapas.filter((e) => e.kind === "open").map((e) => e.name);
  if (abiertas.length > 0) bp.pipeline = { stages: abiertas };

  if (perfil) {
    bp.agent = {
      name: perfil.name,
      tone: perfil.tone,
      ...(perfil.role in ROLES ? { role: perfil.role as ClaveRol } : {}),
      tools: perfil.tools ? (perfil.tools.filter(esClaveHerramienta) as ClaveHerramienta[]) : null,
      instructions: perfil.instructions,
      escalationRules: perfil.escalationRules,
      greeting: perfil.greeting,
    };
  }

  bp.knowledge = {
    mode: "exact",
    entries: kb.flatMap((e): Entrada[] => {
      if (e.kind === "qa" && e.question && e.answer) return [{ kind: "qa", question: e.question, answer: e.answer }];
      if (e.kind === "block" && e.content) return [{ kind: "block", content: e.content }];
      return [];
    }),
  };

  if (calendario.length > 0) {
    const s = await getSettings(organizationId);
    bp.agenda = {
      weeklyHours: s.weeklyHours,
      slotMinutes: s.slotMinutes,
      bufferMinutes: s.bufferMinutes,
      minNoticeHours: s.minNoticeHours,
      maxDaysAhead: s.maxDaysAhead,
      timezone: s.timezone,
      ...(s.connector === "enlace-fijo" ? { connector: "enlace-fijo" as const } : {}),
      meetingLink: s.meetingLink,
    };
  }
  return bp;
}
