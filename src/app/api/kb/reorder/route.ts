import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

// 074: un acceso de soporte no la modifica (la lista de rutas con soporte de
// configuración es cerrada: tests/unit/soporte-rutas-configuracion.test.ts).

const reorderSchema = z
  .object({ ids: z.array(z.string().min(1).max(64)).min(1).max(500) })
  .strict()
  .refine((d) => new Set(d.ids).size === d.ids.length, { message: "ids_repetidos" });

/**
 * 074 (D8) — `POST /api/kb/reorder {ids}`: el orden que dejó el dueño
 * (`sort_order` = posición). Todos los ids tienen que ser de ESTE negocio; si
 * falta alguno, 404 y no se toca nada (una lista ajena no reordena la mía).
 */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, reorderSchema);
  if (!body.ok) return body.response;
  const { ids } = body.data;
  const db = getDb();
  const t = schema.kbEntry;
  const propias = await db
    .select({ id: t.id })
    .from(t)
    .where(scoped(t.organizationId, session.organizationId, inArray(t.id, ids)));
  if (propias.length !== ids.length) return apiError(404, "not_found", "Alguna entrada no existe");
  await db.transaction(async (tx) => {
    for (const [i, id] of ids.entries()) {
      await tx
        .update(t)
        .set({ sortOrder: i, updatedAt: new Date() })
        .where(and(eq(t.organizationId, session.organizationId), eq(t.id, id)));
    }
  });
  return Response.json({ ok: true });
});
