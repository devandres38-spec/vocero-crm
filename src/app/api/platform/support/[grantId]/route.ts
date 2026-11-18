import { requirePlataforma } from "@/server/platform/guardia";
import { errorPlataforma } from "@/server/platform/http";
import { revocarSoporte } from "@/server/platform/soporte";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ grantId: string }> };

/** 069 (US5) — Cerrar un acceso de soporte; se corta en la siguiente petición. */
export async function DELETE(req: Request, ctx: Params): Promise<Response> {
  const g = await requirePlataforma(req, { soloSesion: true });
  if (!g.ok) return g.response;
  const ok = await revocarSoporte(g.actor, (await ctx.params).grantId);
  if (!ok) return errorPlataforma(404, "acceso_inexistente");
  return Response.json({ revoked: true });
}
