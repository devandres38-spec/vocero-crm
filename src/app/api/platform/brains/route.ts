import { z } from "zod";
import { crearDespliegue, listarDespliegues } from "@/server/brains/deployment";
import { requirePlataforma } from "@/server/platform/guardia";
import { errorPlataforma, leerJson, respuestaDeError } from "@/server/platform/http";

export const dynamic = "force-dynamic";

/**
 * 070 (D12) — Despliegues de cerebro. Leer: sesión o token `read` (sin
 * secretos). Crear: SOLO con sesión, porque la respuesta lleva el secreto y
 * el secreto no debe pasar por una IA.
 */
export async function GET(req: Request): Promise<Response> {
  const g = await requirePlataforma(req, { scope: "read" });
  if (!g.ok) return g.response;
  return Response.json({ deployments: await listarDespliegues() });
}

const esquemaCrear = z
  .object({
    name: z.string().trim().min(1).max(60),
    dispatchUrl: z.string().trim().min(1).max(2048),
    healthUrl: z.string().trim().max(2048).nullable().optional(),
    /** Pegar el `CRM_BRAIN_SECRET` de una Nea ya desplegada. */
    secret: z.string().max(256).nullable().optional(),
  })
  .strict();

export async function POST(req: Request): Promise<Response> {
  const g = await requirePlataforma(req, { soloSesion: true });
  if (!g.ok) return g.response;
  const body = await leerJson(req);
  if (!body.ok) return body.response;
  const p = esquemaCrear.safeParse(body.data);
  if (!p.success) {
    return errorPlataforma(
      422,
      "invalid_body",
      "Datos inválidos",
      p.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }))
    );
  }
  try {
    const r = await crearDespliegue(g.actor, p.data);
    return Response.json({ secret: r.secret, deployment: r.despliegue }, { status: 201 });
  } catch (err) {
    return respuestaDeError(err);
  }
}
