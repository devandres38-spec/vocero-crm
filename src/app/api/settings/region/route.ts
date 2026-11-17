import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { getDb, schema } from "@/lib/db";
import { esLocale, esPais, esZonaValida } from "@/lib/region";
import { esPlataforma } from "@/lib/tenancy";
import { getRegionDeOrganizacion } from "@/server/region";

export const dynamic = "force-dynamic";

/**
 * 069 (US6) — País, idioma y zona del negocio, en modo plataforma. En
 * `single` la región es de la instancia (`REGION_*`) y esta ruta no existe.
 * Solo quien configura el negocio; un acceso de soporte no la cambia (no es
 * una de las superficies acordadas).
 */
export const GET = withAuth(async (session) => {
  if (!esPlataforma()) return new Response(null, { status: 404 });
  return Response.json({ region: await getRegionDeOrganizacion(session.organizationId) });
});

const putSchema = z
  .object({
    country: z
      .string()
      .transform((v) => v.trim().toUpperCase())
      .refine(esPais, "País inválido (código de 2 letras)"),
    locale: z.string().trim().refine(esLocale, "Idioma y formato inválido (p. ej. es-CO)"),
    timezone: z.string().trim().refine(esZonaValida, "Zona horaria inválida (IANA)"),
  })
  .strict();

export const PUT = withAuth(async (session, req: Request) => {
  if (!esPlataforma()) return new Response(null, { status: 404 });
  if (!canConfigure(session.role)) {
    return apiError(403, "forbidden", "Solo quien administra el negocio puede cambiar su región");
  }
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  const db = getDb();
  // Solo SU organización: la fila sale del id de la sesión (A↛B).
  const [fila] = await db
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, session.organizationId))
    .limit(1);
  let meta: Record<string, unknown> = {};
  try {
    const m = fila?.metadata ? (JSON.parse(fila.metadata) as unknown) : null;
    if (m && typeof m === "object" && !Array.isArray(m)) meta = m as Record<string, unknown>;
  } catch {
    meta = {};
  }
  meta.region = body.data;
  await db
    .update(schema.organization)
    .set({ metadata: JSON.stringify(meta) })
    .where(eq(schema.organization.id, session.organizationId));
  return Response.json({ region: body.data });
});
