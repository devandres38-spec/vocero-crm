import { and, asc, eq, inArray } from "drizzle-orm";
import { schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import type { OrganizationBlueprint } from "@/lib/platform/blueprint";
import type { Tx } from "./metadata";

/**
 * Auditoría 069 (Fix-B) — Respuestas rápidas (`/atajo`, 049), declarativas.
 *
 * Identidad: el atajo normalizado (el contrato ya lo normalizó). `merge`
 * (default) agrega lo que falta y actualiza el texto de un atajo existente;
 * nunca borra. `exact` además borra los atajos que el Blueprint no trae.
 * Aplicar dos veces lo mismo no cambia nada.
 */

type Respuestas = NonNullable<OrganizationBlueprint["quickReplies"]>;
type Fila = { id: string; atajo: string; texto: string };

export type PlanRespuestas = {
  crear: { atajo: string; texto: string }[];
  actualizar: { id: string; texto: string }[];
  borrar: string[];
};

/** Pura: qué crear, actualizar y borrar. */
export function planificarRespuestas(actuales: Fila[], deseado: Respuestas): PlanRespuestas {
  const plan: PlanRespuestas = { crear: [], actualizar: [], borrar: [] };
  const porAtajo = new Map(actuales.map((f) => [f.atajo, f]));
  const pedidos = new Set<string>();
  for (const e of deseado.entries) {
    if (pedidos.has(e.shortcut)) continue;
    pedidos.add(e.shortcut);
    const f = porAtajo.get(e.shortcut);
    if (!f) plan.crear.push({ atajo: e.shortcut, texto: e.text });
    else if (f.texto !== e.text) plan.actualizar.push({ id: f.id, texto: e.text });
  }
  if (deseado.mode === "exact") {
    for (const f of actuales) if (!pedidos.has(f.atajo)) plan.borrar.push(f.id);
  }
  return plan;
}

export async function aplicarRespuestas(
  tx: Tx,
  organizationId: string,
  deseado: Respuestas
): Promise<{ cambio: boolean; conteos: { creadas: number; actualizadas: number; borradas: number } }> {
  const actuales = (await tx
    .select({ id: schema.quickReply.id, atajo: schema.quickReply.atajo, texto: schema.quickReply.texto })
    .from(schema.quickReply)
    .where(eq(schema.quickReply.organizationId, organizationId))
    .orderBy(asc(schema.quickReply.atajo))) as Fila[];

  const plan = planificarRespuestas(actuales, deseado);
  if (plan.borrar.length > 0) {
    await tx
      .delete(schema.quickReply)
      .where(and(eq(schema.quickReply.organizationId, organizationId), inArray(schema.quickReply.id, plan.borrar)));
  }
  for (const a of plan.actualizar) {
    await tx
      .update(schema.quickReply)
      .set({ texto: a.texto, updatedAt: new Date() })
      .where(and(eq(schema.quickReply.id, a.id), eq(schema.quickReply.organizationId, organizationId)));
  }
  if (plan.crear.length > 0) {
    await tx.insert(schema.quickReply).values(
      plan.crear.map((e) => ({ id: newId("quickReply"), organizationId, atajo: e.atajo, texto: e.texto }))
    );
  }
  const conteos = { creadas: plan.crear.length, actualizadas: plan.actualizar.length, borradas: plan.borrar.length };
  return { cambio: conteos.creadas + conteos.actualizadas + conteos.borradas > 0, conteos };
}
