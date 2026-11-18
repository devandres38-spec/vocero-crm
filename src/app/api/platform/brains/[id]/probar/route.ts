import { probarDespliegue } from "@/server/brains/salud";
import { requirePlataforma } from "@/server/platform/guardia";
import { errorPlataforma, respuestaDeError } from "@/server/platform/http";
import { checkRateLimit } from "@/lib/rate-limit";

const PROBAR_RATE_LIMIT = { windowMs: 60_000, max: 12 };

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 070 (D13) — Pregunta al `/health` del despliegue. Solo con sesión. */
export async function POST(req: Request, ctx: Params): Promise<Response> {
  const g = await requirePlataforma(req, { soloSesion: true, exigirOrigen: true });
  if (!g.ok) return g.response;
  // Auditoría 070 (B-3): cada «Probar» es una petición saliente; con tope.
  if (!checkRateLimit(`brain-probar:${g.actor.userId}`, PROBAR_RATE_LIMIT).allowed) {
    return errorPlataforma(429, "demasiados_intentos", "Espera un momento antes de volver a probar");
  }
  try {
    return Response.json({ health: await probarDespliegue(g.actor, (await ctx.params).id) });
  } catch (err) {
    return respuestaDeError(err);
  }
}
