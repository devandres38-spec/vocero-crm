import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { kbCategoriaSchema, kbTituloSchema } from "@/lib/kb";
import { kbDelNegocio } from "@/server/kb";

/** 069 (D5) — Configuración del negocio: la puede cambiar un acceso de soporte de nivel `configuracion`. */
const SOPORTE_CONFIGURACION = { soporte: "configuracion" } as const;

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  // 074 (D8): todas (también las apagadas), fijadas primero y en su orden.
  const entries = await kbDelNegocio(session.organizationId);
  return Response.json({ entries });
});

/** 074 (D8) — Lo que comparten los dos tipos: todo opcional, con los defaults de la tabla. */
const organizacion = {
  title: kbTituloSchema.nullable().optional(),
  category: kbCategoriaSchema.optional(),
  enabled: z.boolean().optional(),
  pinned: z.boolean().optional(),
  sortOrder: z.number().int().min(-100_000).max(100_000).optional(),
};

const createSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("qa"),
      question: z.string().trim().min(1).max(500),
      answer: z.string().trim().min(1).max(4000),
      ...organizacion,
    }),
    z.object({
      kind: z.literal("block"),
      content: z.string().trim().min(1).max(8000),
      ...organizacion,
    }),
  ]);

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const inserted = await db
    .insert(schema.kbEntry)
    .values({
      id: newId("kbEntry"),
      organizationId: session.organizationId,
      kind: body.data.kind,
      question: body.data.kind === "qa" ? body.data.question : null,
      answer: body.data.kind === "qa" ? body.data.answer : null,
      content: body.data.kind === "block" ? body.data.content : null,
      title: body.data.title?.trim() || null,
      ...(body.data.category ? { category: body.data.category } : {}),
      ...(body.data.enabled !== undefined ? { enabled: body.data.enabled } : {}),
      ...(body.data.pinned !== undefined ? { pinned: body.data.pinned } : {}),
      ...(body.data.sortOrder !== undefined ? { sortOrder: body.data.sortOrder } : {}),
    })
    .returning();
  if (!inserted[0]) return apiError(500, "internal", "No se pudo crear");
  return Response.json({ entry: inserted[0] }, { status: 201 });
}, SOPORTE_CONFIGURACION);
