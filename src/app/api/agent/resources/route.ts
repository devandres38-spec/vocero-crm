import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { recursosSchema } from "@/lib/kb";
import { recursosDe } from "@/server/kb";

export const dynamic = "force-dynamic";

// 074: un acceso de soporte no la modifica (la lista de rutas con soporte de
// configuración es cerrada: tests/unit/soporte-rutas-configuracion.test.ts).

/**
 * 074 (D8, FR-05) — Los enlaces oficiales verificados del negocio (Maps,
 * catálogo, web, link de pago). Hasta 10, solo `https://`. Son los ÚNICOS
 * enlaces que el agente puede compartir (contrato brains-074 §2).
 */
export const GET = withAuth(async (session) => {
  return Response.json({ resources: await recursosDe(session.organizationId) });
});

const putSchema = z.object({ resources: recursosSchema }).strict();

export const PUT = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  const vistas = new Set<string>();
  const resources = body.data.resources.filter((r) => {
    const k = r.url.toLowerCase();
    if (vistas.has(k)) return false;
    vistas.add(k);
    return true;
  });
  const actualizadas = await getDb()
    .update(schema.agentProfile)
    .set({ resources, updatedAt: new Date() })
    .where(scoped(schema.agentProfile.organizationId, session.organizationId))
    .returning({ id: schema.agentProfile.id });
  if (!actualizadas[0]) return apiError(404, "no_profile", "El negocio todavía no tiene perfil de agente");
  return Response.json({ resources });
});
