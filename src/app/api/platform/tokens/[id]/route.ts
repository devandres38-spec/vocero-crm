import { requirePlataforma } from "@/server/platform/guardia";
import { errorPlataforma } from "@/server/platform/http";
import { revocarToken } from "@/server/platform/tokens";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 069 (D14) — Revoca un token propio; deja de valer en la siguiente llamada. */
export async function DELETE(req: Request, ctx: Params): Promise<Response> {
  const g = await requirePlataforma(req, { soloSesion: true });
  if (!g.ok) return g.response;
  const ok = await revocarToken(g.actor.userId, (await ctx.params).id, g.actor.ip);
  if (!ok) return errorPlataforma(404, "token_inexistente");
  return Response.json({ revoked: true });
}
