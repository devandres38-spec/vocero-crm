import { and, asc, eq, inArray } from "drizzle-orm";
import { schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { normalizarNombre, type OrganizationBlueprint } from "@/lib/platform/blueprint";
import type { Tx } from "./metadata";

/**
 * 069 (D12) — La base de conocimiento, declarativa.
 *
 * Identidad de una entrada: una pregunta (`qa`) por su pregunta normalizada;
 * un bloque por su contenido normalizado. Así:
 * - `merge` (default): agrega lo que falta y, si una pregunta ya existe con
 *   otra respuesta, actualiza la respuesta. Nunca borra.
 * - `exact`: además borra lo que el Blueprint no trae.
 * Aplicar dos veces lo mismo no cambia nada.
 */

type Conocimiento = NonNullable<OrganizationBlueprint["knowledge"]>;
type Entrada = Conocimiento["entries"][number];
type Fila = {
  id: string;
  kind: "qa" | "block";
  question: string | null;
  answer: string | null;
  content: string | null;
};

const clave = (e: { kind: string; question?: string | null; content?: string | null }) =>
  e.kind === "qa" ? `qa:${normalizarNombre(e.question ?? "")}` : `block:${normalizarNombre(e.content ?? "")}`;

export type PlanConocimiento = {
  crear: Entrada[];
  actualizar: { id: string; answer: string }[];
  borrar: string[];
};

/** Pura: qué crear, actualizar y borrar. */
export function planificarConocimiento(actuales: Fila[], deseado: Conocimiento): PlanConocimiento {
  const plan: PlanConocimiento = { crear: [], actualizar: [], borrar: [] };
  const porClave = new Map(actuales.map((f) => [clave(f), f]));
  const pedidas = new Set<string>();
  for (const e of deseado.entries) {
    const k = clave(e);
    if (pedidas.has(k)) continue; // repetida dentro del mismo Blueprint
    pedidas.add(k);
    const f = porClave.get(k);
    if (!f) plan.crear.push(e);
    else if (e.kind === "qa" && (f.answer ?? "").trim() !== e.answer.trim()) {
      plan.actualizar.push({ id: f.id, answer: e.answer.trim() });
    }
  }
  if (deseado.mode === "exact") {
    for (const f of actuales) if (!pedidas.has(clave(f))) plan.borrar.push(f.id);
  }
  return plan;
}

export async function aplicarConocimiento(
  tx: Tx,
  organizationId: string,
  deseado: Conocimiento
): Promise<{ cambio: boolean; conteos: { creadas: number; actualizadas: number; borradas: number } }> {
  const actuales = (await tx
    .select({
      id: schema.kbEntry.id,
      kind: schema.kbEntry.kind,
      question: schema.kbEntry.question,
      answer: schema.kbEntry.answer,
      content: schema.kbEntry.content,
    })
    .from(schema.kbEntry)
    .where(eq(schema.kbEntry.organizationId, organizationId))
    .orderBy(asc(schema.kbEntry.createdAt))) as Fila[];

  const plan = planificarConocimiento(actuales, deseado);
  if (plan.borrar.length > 0) {
    await tx
      .delete(schema.kbEntry)
      .where(and(eq(schema.kbEntry.organizationId, organizationId), inArray(schema.kbEntry.id, plan.borrar)));
  }
  for (const a of plan.actualizar) {
    await tx
      .update(schema.kbEntry)
      .set({ answer: a.answer, updatedAt: new Date() })
      .where(and(eq(schema.kbEntry.id, a.id), eq(schema.kbEntry.organizationId, organizationId)));
  }
  if (plan.crear.length > 0) {
    await tx.insert(schema.kbEntry).values(
      plan.crear.map((e) => ({
        id: newId("kbEntry"),
        organizationId,
        kind: e.kind,
        question: e.kind === "qa" ? e.question.trim() : null,
        answer: e.kind === "qa" ? e.answer.trim() : null,
        content: e.kind === "block" ? e.content.trim() : null,
      }))
    );
  }
  const conteos = { creadas: plan.crear.length, actualizadas: plan.actualizar.length, borradas: plan.borrar.length };
  return { cambio: conteos.creadas + conteos.actualizadas + conteos.borradas > 0, conteos };
}
