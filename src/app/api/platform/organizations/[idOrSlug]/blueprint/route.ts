import { aplicarBlueprint, buscarOrganizacion } from "@/server/platform/blueprint/aplicar";
import { exportarBlueprint } from "@/server/platform/blueprint/exportar";
import { requirePlataforma } from "@/server/platform/guardia";
import { errorPlataforma, esDryRun, leerJson, respuestaDeError } from "@/server/platform/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ idOrSlug: string }> };

/**
 * 069 (D12, D13) — El Blueprint vigente de una organización. Aplicarlo tal
 * cual no cambia nada. Es configuración del negocio (agente, conocimiento),
 * no datos de sus clientes.
 */
export async function GET(req: Request, ctx: Params): Promise<Response> {
  const g = await requirePlataforma(req, { scope: "read" });
  if (!g.ok) return g.response;
  try {
    const org = await buscarOrganizacion((await ctx.params).idOrSlug);
    const bp = org ? await exportarBlueprint(org.id) : null;
    if (!bp) return errorPlataforma(404, "organizacion_inexistente");
    return Response.json(bp);
  } catch (err) {
    return respuestaDeError(err);
  }
}

/**
 * Aplica un Blueprint (declarativo e idempotente; las secciones ausentes no se
 * tocan). `?dryRun=true` devuelve el plan sin escribir.
 */
export async function PUT(req: Request, ctx: Params): Promise<Response> {
  const dryRun = esDryRun(req);
  const g = await requirePlataforma(req, { scope: dryRun ? "read" : "provision" });
  if (!g.ok) return g.response;
  const body = await leerJson(req);
  if (!body.ok) return body.response;
  try {
    const org = await buscarOrganizacion((await ctx.params).idOrSlug);
    if (!org) return errorPlataforma(404, "organizacion_inexistente");
    return Response.json(await aplicarBlueprint(g.actor, { organizationId: org.id }, body.data, { dryRun }));
  } catch (err) {
    return respuestaDeError(err);
  }
}
