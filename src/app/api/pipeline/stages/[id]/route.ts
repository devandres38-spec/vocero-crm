import { and, count, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { relocateLeadsFromStage } from "@/server/leads/stage-history";
import { EVENTOS_ETAPA } from "@/lib/eventos-etapa";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  position: z.number().int().min(0).optional(),
  /**
   * 078 (D18) — El evento del cerebro que mueve al lead a esta etapa; `null`
   * lo quita. Solo en etapas abiertas, y uno por evento: si otra etapa lo
   * tenía, pasa a esta.
   */
  eventoBot: z.enum(EVENTOS_ETAPA).nullable().optional(),
});

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const { eventoBot } = body.data;
  if (eventoBot) {
    // Ganar y perder son de una persona: el agente no mueve a esas etapas.
    // La base también lo impide (CHECK), esto da el mensaje claro.
    const [etapa] = await db
      .select({ kind: schema.pipelineStage.kind })
      .from(schema.pipelineStage)
      .where(
        scoped(schema.pipelineStage.organizationId, session.organizationId, eq(schema.pipelineStage.id, id))
      )
      .limit(1);
    if (!etapa) return apiError(404, "not_found", "Etapa no encontrada");
    if (etapa.kind !== "open") {
      return apiError(
        409,
        "etapa_cerrada",
        "El agente solo mueve a etapas abiertas: ganar o perder lo decide una persona"
      );
    }
    // Uno por evento en cada negocio: si otra etapa lo tenía, pasa a esta.
    await db
      .update(schema.pipelineStage)
      .set({ eventoBot: null })
      .where(
        scoped(
          schema.pipelineStage.organizationId,
          session.organizationId,
          and(eq(schema.pipelineStage.eventoBot, eventoBot), ne(schema.pipelineStage.id, id))
        )
      );
  }
  const updated = await db
    .update(schema.pipelineStage)
    .set({
      ...(body.data.name !== undefined ? { name: body.data.name } : {}),
      ...(body.data.position !== undefined
        ? { position: body.data.position }
        : {}),
      ...(eventoBot !== undefined ? { eventoBot } : {}),
    })
    .where(
      scoped(
        schema.pipelineStage.organizationId,
        session.organizationId,
        eq(schema.pipelineStage.id, id)
      )
    )
    .returning();
  if (!updated[0]) return apiError(404, "not_found", "Etapa no encontrada");
  return Response.json({ stage: updated[0] });
});

export const DELETE = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const moveTo = url.searchParams.get("moveTo");

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.pipelineStage)
    .where(
      scoped(
        schema.pipelineStage.organizationId,
        session.organizationId,
        eq(schema.pipelineStage.id, id)
      )
    )
    .limit(1);
  const stage = rows[0];
  if (!stage) return apiError(404, "not_found", "Etapa no encontrada");
  if (stage.kind !== "open") {
    return apiError(
      409,
      "anchor_stage",
      'Las etapas ancla ("ganado" y "perdido") no se pueden eliminar'
    );
  }

  const leadsInStage = await db
    .select({ n: count() })
    .from(schema.lead)
    .where(
      scoped(
        schema.lead.organizationId,
        session.organizationId,
        eq(schema.lead.stageId, id)
      )
    );
  const n = leadsInStage[0]?.n ?? 0;

  if (n > 0) {
    if (!moveTo) {
      return apiError(
        409,
        "stage_has_leads",
        "La etapa tiene tarjetas: indica ?moveTo=<etapa destino> para reasignarlas"
      );
    }
    const dest = await db
      .select({ id: schema.pipelineStage.id })
      .from(schema.pipelineStage)
      .where(
        scoped(
          schema.pipelineStage.organizationId,
          session.organizationId,
          eq(schema.pipelineStage.id, moveTo)
        )
      )
      .limit(1);
    if (!dest[0] || moveTo === id) {
      return apiError(422, "invalid_move_to", "Etapa destino inválida");
    }
    // Por la puerta única, un evento por lead: el embudo debe poder explicar
    // por qué treinta tarjetas cambiaron de columna el mismo minuto.
    await relocateLeadsFromStage({
      organizationId: session.organizationId,
      fromStageId: id,
      toStageId: moveTo,
      actorUserId: session.userId,
    });
  }

  await db
    .delete(schema.pipelineStage)
    .where(
      scoped(
        schema.pipelineStage.organizationId,
        session.organizationId,
        eq(schema.pipelineStage.id, id)
      )
    );
  return Response.json({ deleted: true, movedLeads: n });
});
