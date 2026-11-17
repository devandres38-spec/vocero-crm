import { aplicarBlueprint } from "@/server/platform/blueprint/aplicar";
import { requirePlataforma } from "@/server/platform/guardia";
import { esDryRun, leerJson, respuestaDeError } from "@/server/platform/http";
import { listarOrganizaciones } from "@/server/platform/organizaciones";

export const dynamic = "force-dynamic";

/** 069 — Organizaciones de la plataforma (solo Super-Admin; 404 si no). */
export async function GET(req: Request): Promise<Response> {
  const g = await requirePlataforma(req, { scope: "read" });
  if (!g.ok) return g.response;
  try {
    return Response.json({ organizations: await listarOrganizaciones() });
  } catch (err) {
    return respuestaDeError(err);
  }
}

/**
 * Crear = aplicar un `OrganizationBlueprint` con `organization.slug` y
 * `organization.name`. `?dryRun=true` devuelve el plan sin crear nada.
 */
export async function POST(req: Request): Promise<Response> {
  // H-05 — Planificar no escribe: basta `read`, igual que PUT …/blueprint
  // y que `plan_blueprint` en el MCP.
  const dryRun = esDryRun(req);
  const g = await requirePlataforma(req, { scope: dryRun ? "read" : "provision" });
  if (!g.ok) return g.response;
  const body = await leerJson(req);
  if (!body.ok) return body.response;
  try {
    const r = await aplicarBlueprint(g.actor, { crear: true }, body.data, { dryRun });
    return Response.json(r, { status: r.dryRun ? 200 : 201 });
  } catch (err) {
    return respuestaDeError(err);
  }
}
