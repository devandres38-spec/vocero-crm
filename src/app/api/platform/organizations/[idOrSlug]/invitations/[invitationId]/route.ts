import { buscarOrganizacion } from "@/server/platform/blueprint/aplicar";
import { requirePlataforma } from "@/server/platform/guardia";
import { errorPlataforma, respuestaDeError } from "@/server/platform/http";
import { revocarInvitacion } from "@/server/platform/invitaciones";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ idOrSlug: string; invitationId: string }> };

/** 069 — Revoca una invitación pendiente de ESA organización (A↛B). */
export async function DELETE(req: Request, ctx: Params): Promise<Response> {
  const g = await requirePlataforma(req, { scope: "provision" });
  if (!g.ok) return g.response;
  try {
    const { idOrSlug, invitationId } = await ctx.params;
    const org = await buscarOrganizacion(idOrSlug);
    if (!org) return errorPlataforma(404, "organizacion_inexistente");
    const ok = await revocarInvitacion(g.actor, org.id, invitationId);
    if (!ok) return errorPlataforma(404, "invitacion_inexistente");
    return Response.json({ revoked: true });
  } catch (err) {
    return respuestaDeError(err);
  }
}
