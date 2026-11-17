import { buscarOrganizacion } from "@/server/platform/blueprint/aplicar";
import { requirePlataforma } from "@/server/platform/guardia";
import { errorPlataforma, leerJson, respuestaDeError } from "@/server/platform/http";
import { otorgarSoporte, solicitudSoporteSchema } from "@/server/platform/soporte";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ idOrSlug: string }> };

/**
 * 069 (US5) — Abrir un acceso de soporte. SOLO con sesión de una persona: ni
 * un token de API ni el MCP pueden abrir accesos a datos de un negocio.
 */
export async function POST(req: Request, ctx: Params): Promise<Response> {
  const g = await requirePlataforma(req, { soloSesion: true });
  if (!g.ok) return g.response;
  const body = await leerJson(req);
  if (!body.ok) return body.response;
  const p = solicitudSoporteSchema.safeParse(body.data);
  if (!p.success) {
    return errorPlataforma(
      422,
      "invalid_body",
      "Datos inválidos",
      p.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }))
    );
  }
  try {
    const org = await buscarOrganizacion((await ctx.params).idOrSlug);
    if (!org) return errorPlataforma(404, "organizacion_inexistente");
    const r = await otorgarSoporte(g.actor, org.id, p.data);
    return Response.json({ grantId: r.id, expiresAt: r.expiresAt.toISOString() }, { status: 201 });
  } catch (err) {
    return respuestaDeError(err);
  }
}
