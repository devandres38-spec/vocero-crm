import { buscarOrganizacion } from "@/server/platform/blueprint/aplicar";
import { listarAuditoria } from "@/server/platform/auditoria-consulta";
import { requirePlataforma } from "@/server/platform/guardia";
import { errorPlataforma, respuestaDeError } from "@/server/platform/http";

export const dynamic = "force-dynamic";

/**
 * Auditoría 069 (Fix-B) — El rastro de la plataforma (alcance `read`), con
 * los mismos filtros que la herramienta MCP `list_audit_log`:
 * `?org=<id|slug>&action=…&via=sesion|api|mcp&limit=…&before=<ISO>`.
 */
export async function GET(req: Request): Promise<Response> {
  const g = await requirePlataforma(req, { scope: "read" });
  if (!g.ok) return g.response;
  try {
    const q = new URL(req.url).searchParams;
    const idOrSlug = q.get("org");
    const org = idOrSlug ? await buscarOrganizacion(idOrSlug) : null;
    if (idOrSlug && !org) return errorPlataforma(404, "organizacion_inexistente");
    return Response.json(
      await listarAuditoria({
        organizationId: org?.id ?? null,
        action: q.get("action"),
        via: q.get("via"),
        limit: q.get("limit") ? Number(q.get("limit")) : undefined,
        before: q.get("before"),
      })
    );
  } catch (err) {
    return respuestaDeError(err);
  }
}
