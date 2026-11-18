import { z } from "zod";
import { asignarCerebro, cerebroDeOrganizacion } from "@/server/brains/deployment";
import { buscarOrganizacion } from "@/server/platform/blueprint/aplicar";
import { requirePlataforma } from "@/server/platform/guardia";
import { errorPlataforma, leerJson, respuestaDeError } from "@/server/platform/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ idOrSlug: string }> };

/** 070 (US2) — Qué cerebro atiende a este negocio (sin URL ni secreto). */
export async function GET(req: Request, ctx: Params): Promise<Response> {
  const g = await requirePlataforma(req, { scope: "read" });
  if (!g.ok) return g.response;
  const org = await buscarOrganizacion((await ctx.params).idOrSlug);
  if (!org) return errorPlataforma(404, "organizacion_inexistente");
  return Response.json({ brain: await cerebroDeOrganizacion(org.id) });
}

const esquema = z.object({ deployment: z.string().trim().min(1).max(64).nullable() }).strict();

/** Asigna (o quita con `null`) el despliegue. Auditado `cerebro_asignado`. */
export async function PUT(req: Request, ctx: Params): Promise<Response> {
  const g = await requirePlataforma(req, { scope: "provision", exigirOrigen: true });
  if (!g.ok) return g.response;
  const body = await leerJson(req);
  if (!body.ok) return body.response;
  const p = esquema.safeParse(body.data);
  if (!p.success) return errorPlataforma(422, "invalid_body", "Datos inválidos");
  try {
    const org = await buscarOrganizacion((await ctx.params).idOrSlug);
    if (!org) return errorPlataforma(404, "organizacion_inexistente");
    await asignarCerebro(g.actor, org.id, p.data.deployment);
    return Response.json({ brain: await cerebroDeOrganizacion(org.id) });
  } catch (err) {
    return respuestaDeError(err);
  }
}
