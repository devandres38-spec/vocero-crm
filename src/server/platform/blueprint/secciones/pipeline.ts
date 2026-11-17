import { and, asc, count, eq, inArray } from "drizzle-orm";
import { schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { normalizarNombre } from "@/lib/platform/blueprint";
import type { Tx } from "./metadata";

/**
 * 069 (D12) — Las etapas ABIERTAS del pipeline, declarativas y por nombre.
 *
 * - Las que faltan se crean; las que ya están (mismo nombre normalizado) se
 *   conservan con su id (sus leads no se mueven) y toman el orden pedido.
 * - Una etapa abierta que el Blueprint no menciona se borra SOLO si no tiene
 *   leads; si los tiene, se conserva al final y se advierte: un Blueprint
 *   nunca borra datos.
 * - Las anclas «ganado» y «perdido» no se tocan y siempre van al final.
 */

type Etapa = { id: string; name: string; position: number; kind: "open" | "won" | "lost" };

export type PlanPipeline = {
  crear: { name: string; position: number }[];
  actualizar: { id: string; name: string; position: number }[];
  borrar: string[];
  advertencias: string[];
};

/** Pura: el plan a partir de lo que hay y lo que se pide. */
export function planificarPipeline(
  actuales: Etapa[],
  deseadas: string[],
  conLeads: ReadonlySet<string>
): PlanPipeline {
  const plan: PlanPipeline = { crear: [], actualizar: [], borrar: [], advertencias: [] };
  const abiertas = actuales.filter((e) => e.kind === "open");
  const anclas = actuales.filter((e) => e.kind !== "open").sort((a, b) => a.position - b.position);
  const nombresAncla = new Set(anclas.map((a) => normalizarNombre(a.name)));
  const porNombre = new Map(abiertas.map((e) => [normalizarNombre(e.name), e]));
  const usadas = new Set<string>();

  const orden: { id?: string; name: string }[] = [];
  for (const nombre of deseadas) {
    const clave = normalizarNombre(nombre);
    if (nombresAncla.has(clave)) {
      plan.advertencias.push(`nombre_de_ancla:${nombre}`);
      continue;
    }
    const existente = porNombre.get(clave);
    if (existente && !usadas.has(existente.id)) {
      usadas.add(existente.id);
      orden.push({ id: existente.id, name: nombre.trim() });
    } else {
      orden.push({ name: nombre.trim() });
    }
  }
  for (const e of abiertas) {
    if (usadas.has(e.id)) continue;
    if (conLeads.has(e.id)) {
      plan.advertencias.push(`etapa_con_leads_conservada:${e.name}`);
      orden.push({ id: e.id, name: e.name });
    } else {
      plan.borrar.push(e.id);
    }
  }

  const final = [...orden, ...anclas.map((a) => ({ id: a.id, name: a.name }))];
  final.forEach((e, position) => {
    if (!e.id) {
      plan.crear.push({ name: e.name, position });
      return;
    }
    const actual = actuales.find((a) => a.id === e.id)!;
    if (actual.name !== e.name || actual.position !== position) {
      plan.actualizar.push({ id: e.id, name: e.name, position });
    }
  });
  return plan;
}

export async function aplicarPipeline(
  tx: Tx,
  organizationId: string,
  deseadas: string[]
): Promise<{ cambio: boolean; advertencias: string[] }> {
  const actuales = (await tx
    .select({
      id: schema.pipelineStage.id,
      name: schema.pipelineStage.name,
      position: schema.pipelineStage.position,
      kind: schema.pipelineStage.kind,
    })
    .from(schema.pipelineStage)
    .where(eq(schema.pipelineStage.organizationId, organizationId))
    .orderBy(asc(schema.pipelineStage.position))) as Etapa[];

  const abiertas = actuales.filter((e) => e.kind === "open").map((e) => e.id);
  const conteos =
    abiertas.length === 0
      ? []
      : await tx
          .select({ stageId: schema.lead.stageId, n: count() })
          .from(schema.lead)
          .where(and(eq(schema.lead.organizationId, organizationId), inArray(schema.lead.stageId, abiertas)))
          .groupBy(schema.lead.stageId);
  const conLeads = new Set(conteos.filter((c) => c.n > 0).map((c) => c.stageId));

  const plan = planificarPipeline(actuales, deseadas, conLeads);
  for (const id of plan.borrar) {
    await tx
      .delete(schema.pipelineStage)
      .where(and(eq(schema.pipelineStage.id, id), eq(schema.pipelineStage.organizationId, organizationId)));
  }
  for (const e of plan.actualizar) {
    await tx
      .update(schema.pipelineStage)
      .set({ name: e.name, position: e.position })
      .where(and(eq(schema.pipelineStage.id, e.id), eq(schema.pipelineStage.organizationId, organizationId)));
  }
  if (plan.crear.length > 0) {
    await tx.insert(schema.pipelineStage).values(
      plan.crear.map((e) => ({
        id: newId("stage"),
        organizationId,
        name: e.name,
        position: e.position,
        kind: "open" as const,
      }))
    );
  }
  const cambio = plan.borrar.length + plan.actualizar.length + plan.crear.length > 0;
  return { cambio, advertencias: plan.advertencias };
}
