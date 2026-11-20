import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { kbCategoriaSchema, kbTituloSchema } from "@/lib/kb";
import { puedeConfigurar } from "@/lib/auth/roles";

/** 069 (D5) — Configuración del negocio: la puede cambiar un acceso de soporte de nivel `configuracion`. */
const SOPORTE_CONFIGURACION = { soporte: "configuracion" } as const;

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * 074 (D8) — Edición en su sitio: el texto y la organización de la entrada
 * (título, categoría, activa, fijada, orden). Corregir un precio ya no exige
 * borrar. `title: null` o vacío quita el título.
 */
const patchSchema = z
  .object({
    question: z.string().trim().min(1).max(500).optional(),
    answer: z.string().trim().min(1).max(4000).optional(),
    content: z.string().trim().min(1).max(8000).optional(),
    title: kbTituloSchema.nullable().optional(),
    category: kbCategoriaSchema.optional(),
    enabled: z.boolean().optional(),
    pinned: z.boolean().optional(),
    sortOrder: z.number().int().min(-100_000).max(100_000).optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: "sin_cambios" });

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  // 074 (auditoría, MEDIO): un `member` atiende la Bandeja, no configura el agente.
  if (!puedeConfigurar(session)) return apiError(403, "forbidden", "Solo quien configura el agente puede cambiar el conocimiento");
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const updated = await db
    .update(schema.kbEntry)
    .set({
      ...body.data,
      ...(body.data.title !== undefined ? { title: body.data.title?.trim() || null } : {}),
      updatedAt: new Date(),
    })
    .where(
      scoped(
        schema.kbEntry.organizationId,
        session.organizationId,
        eq(schema.kbEntry.id, id)
      )
    )
    .returning();
  if (!updated[0]) return apiError(404, "not_found", "Entrada no encontrada");
  return Response.json({ entry: updated[0] });
}, SOPORTE_CONFIGURACION);

export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  // 074 (auditoría, MEDIO): un `member` atiende la Bandeja, no configura el agente.
  if (!puedeConfigurar(session)) return apiError(403, "forbidden", "Solo quien configura el agente puede cambiar el conocimiento");
  const { id } = await ctx.params;
  const db = getDb();
  const deleted = await db
    .delete(schema.kbEntry)
    .where(
      scoped(
        schema.kbEntry.organizationId,
        session.organizationId,
        eq(schema.kbEntry.id, id)
      )
    )
    .returning();
  if (!deleted[0]) return apiError(404, "not_found", "Entrada no encontrada");
  return Response.json({ deleted: true });
}, SOPORTE_CONFIGURACION);
