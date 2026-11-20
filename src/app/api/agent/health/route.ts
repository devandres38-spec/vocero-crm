import { apiError, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { schema } from "@/lib/db";
import { incidentesRecientes, resumenDeUso } from "@/server/llm-usage";

export const dynamic = "force-dynamic";

const TIPOS = new Set<string>(schema.botIncident.kind.enumValues);

/**
 * 074 (D9, FR-14) — Salud del bot del negocio: uso del modelo de los últimos
 * 7 días (`llm_usage`) e incidentes recientes (`bot_incident`, `?kind=`).
 * Solo dueño/admin; solo su organización; sin textos ni datos del cliente.
 */
export const GET = withAuth(async (session, req: Request) => {
  if (!canConfigure(session.role)) return apiError(403, "forbidden", "Solo el dueño o un admin");
  const kind = new URL(req.url).searchParams.get("kind");
  if (kind && !TIPOS.has(kind)) return apiError(422, "invalid_query", "Tipo de incidente desconocido");
  const [uso, incidentes] = await Promise.all([
    resumenDeUso(session.organizationId, 7),
    incidentesRecientes(session.organizationId, kind),
  ]);
  return Response.json({ days: 7, usage: uso, incidents: incidentes, kinds: [...TIPOS] });
});
