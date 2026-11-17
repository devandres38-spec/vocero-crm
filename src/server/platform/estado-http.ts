import { buscarOrganizacion } from "@/server/platform/blueprint/aplicar";
import { requirePlataforma } from "@/server/platform/guardia";
import { errorPlataforma, respuestaDeError } from "@/server/platform/http";
import { cambiarEstado } from "@/server/platform/organizaciones";

/**
 * 069 (D7) — Suspender / reactivar por la API. Idempotente: `changed: false`
 * si ya estaba así. Una sola implementación para las dos rutas.
 */
export async function cambiarEstadoHttp(
  req: Request,
  idOrSlug: string,
  status: "activa" | "suspendida"
): Promise<Response> {
  const g = await requirePlataforma(req, { scope: "provision" });
  if (!g.ok) return g.response;
  try {
    const org = await buscarOrganizacion(idOrSlug);
    const changed = org ? await cambiarEstado(g.actor, org.id, status) : null;
    if (!org || changed === null) return errorPlataforma(404, "organizacion_inexistente");
    return Response.json({ organizationId: org.id, status, changed });
  } catch (err) {
    return respuestaDeError(err);
  }
}
