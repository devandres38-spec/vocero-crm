import { probarDespliegue } from "@/server/brains/salud";
import { requirePlataforma } from "@/server/platform/guardia";
import { respuestaDeError } from "@/server/platform/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 070 (D13) — Pregunta al `/health` del despliegue. Solo con sesión. */
export async function POST(req: Request, ctx: Params): Promise<Response> {
  const g = await requirePlataforma(req, { soloSesion: true });
  if (!g.ok) return g.response;
  try {
    return Response.json({ health: await probarDespliegue(g.actor, (await ctx.params).id) });
  } catch (err) {
    return respuestaDeError(err);
  }
}
