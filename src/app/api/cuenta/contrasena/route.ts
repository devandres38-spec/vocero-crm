import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { cambiarContrasena } from "@/server/auth/cuenta";
import { mismoOrigen } from "@/server/panel/ruta";

export const dynamic = "force-dynamic";

/**
 * 076 — `POST /api/cuenta/contrasena`: cambiar la propia contraseña (cualquier
 * usuario con sesión). Cierra las demás sesiones y limpia «debe cambiarla».
 * La lectura y la escritura de `user` (sin RLS) van en `comoSistema` por dentro.
 */
const cuerpo = z.object({ actual: z.string().min(1).max(256), nueva: z.string().max(256) });

export async function POST(req: Request): Promise<Response> {
  if (!mismoOrigen(req)) return apiError(403, "origen", "Origen no permitido");
  const body = await parseBody(req, cuerpo);
  if (!body.ok) return body.response;
  const r = await cambiarContrasena(req.headers, body.data.actual, body.data.nueva);
  if (!r.ok) return apiError(r.status, r.codigo, r.mensaje);
  const respuesta = Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  // La sesión nueva (las demás se cerraron) viaja en estas cookies.
  for (const c of r.cookies) respuesta.headers.append("Set-Cookie", c);
  return respuesta;
}
