import { z } from "zod";
import { rotarSecreto } from "@/server/brains/deployment";
import { requirePlataforma } from "@/server/platform/guardia";
import { errorPlataforma, respuestaDeError } from "@/server/platform/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const esquema = z.object({ secret: z.string().max(256).nullable().optional() }).strict();

/**
 * 070 — Rota el secreto. El anterior deja de valer en el acto, en las dos
 * direcciones; el nuevo se devuelve UNA vez. Solo con sesión.
 */
export async function POST(req: Request, ctx: Params): Promise<Response> {
  const g = await requirePlataforma(req, { soloSesion: true });
  if (!g.ok) return g.response;
  let data: unknown = {};
  const texto = await req.text();
  if (texto.trim()) {
    try {
      data = JSON.parse(texto);
    } catch {
      return errorPlataforma(422, "invalid_body", "El body debe ser JSON válido");
    }
  }
  const p = esquema.safeParse(data);
  if (!p.success) return errorPlataforma(422, "invalid_body", "Datos inválidos");
  try {
    const r = await rotarSecreto(g.actor, (await ctx.params).id, p.data.secret);
    return Response.json({ secret: r.secret, deployment: r.despliegue });
  } catch (err) {
    return respuestaDeError(err);
  }
}
