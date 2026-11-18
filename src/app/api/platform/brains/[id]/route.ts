import { z } from "zod";
import { actualizarDespliegue, borrarDespliegue, obtenerDespliegue } from "@/server/brains/deployment";
import { requirePlataforma } from "@/server/platform/guardia";
import { errorPlataforma, leerJson, respuestaDeError } from "@/server/platform/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 070 — Un despliegue de cerebro (sin secreto). */
export async function GET(req: Request, ctx: Params): Promise<Response> {
  const g = await requirePlataforma(req, { scope: "read" });
  if (!g.ok) return g.response;
  try {
    return Response.json({ deployment: await obtenerDespliegue((await ctx.params).id) });
  } catch (err) {
    return respuestaDeError(err);
  }
}

const esquema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    dispatchUrl: z.string().trim().min(1).max(2048).optional(),
    healthUrl: z.string().trim().max(2048).nullable().optional(),
    status: z.enum(["activo", "pausado"]).optional(),
  })
  .strict();

/** Editar nombre/URLs o pausar/reactivar. Solo con sesión. */
export async function PATCH(req: Request, ctx: Params): Promise<Response> {
  const g = await requirePlataforma(req, { soloSesion: true, exigirOrigen: true });
  if (!g.ok) return g.response;
  const body = await leerJson(req);
  if (!body.ok) return body.response;
  const p = esquema.safeParse(body.data);
  if (!p.success) {
    return errorPlataforma(
      422,
      "invalid_body",
      "Datos inválidos",
      p.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }))
    );
  }
  const id = (await ctx.params).id;
  try {
    // B-3: campos y estado en UNA transacción.
    return Response.json({ deployment: await actualizarDespliegue(g.actor, id, p.data) });
  } catch (err) {
    return respuestaDeError(err);
  }
}

/** Borrar: solo sin negocios asignados (409 `cerebro_en_uso`). */
export async function DELETE(req: Request, ctx: Params): Promise<Response> {
  const g = await requirePlataforma(req, { soloSesion: true, exigirOrigen: true });
  if (!g.ok) return g.response;
  try {
    await borrarDespliegue(g.actor, (await ctx.params).id);
    return Response.json({ deleted: true });
  } catch (err) {
    return respuestaDeError(err);
  }
}
