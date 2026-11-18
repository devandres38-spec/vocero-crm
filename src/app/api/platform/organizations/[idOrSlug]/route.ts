import { buscarOrganizacion } from "@/server/platform/blueprint/aplicar";
import { requirePlataforma } from "@/server/platform/guardia";
import { errorPlataforma, respuestaDeError } from "@/server/platform/http";
import { detalleOrganizacion } from "@/server/platform/organizaciones";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ idOrSlug: string }> };

/** 069 — Detalle de configuración (sin conversaciones ni contactos). */
export async function GET(req: Request, ctx: Params): Promise<Response> {
  const g = await requirePlataforma(req, { scope: "read" });
  if (!g.ok) return g.response;
  try {
    const org = await buscarOrganizacion((await ctx.params).idOrSlug);
    const detalle = org ? await detalleOrganizacion(org.id) : null;
    if (!detalle) return errorPlataforma(404, "organizacion_inexistente");
    return Response.json({ organization: detalle });
  } catch (err) {
    return respuestaDeError(err);
  }
}
