import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { cerrarTrasActivarSegundoFactor, estadoDelPanel } from "@/server/panel/guard";
import { mismoOrigen, respuestaDelGuard } from "@/server/panel/ruta";
import { iniciarActivacion, verificarActivacion } from "@/server/panel/segundo-factor";

export const dynamic = "force-dynamic";

/**
 * 076 — `POST /api/admin/segundo-factor`: el superadmin activa su TOTP.
 * - `{ accion: "iniciar", contrasena }` → el QR, el secreto y los códigos de
 *   respaldo (una sola vez).
 * - `{ accion: "verificar", codigo }` → activa, marca la fecha y cierra TODAS
 *   sus sesiones: vuelve a entrar con contraseña y código.
 * Solo para un superadmin que aún no lo tiene; con él activado, 409.
 */
const cuerpo = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("iniciar"), contrasena: z.string().min(1).max(256) }),
  z.object({ accion: z.literal("verificar"), codigo: z.string().trim().regex(/^\d{6}$/) }),
]);

const sinCache = { "Cache-Control": "no-store" };

export async function POST(req: Request): Promise<Response> {
  const estado = await estadoDelPanel(req.headers);
  if (estado.tipo === "ok") return apiError(409, "ya_activado", "El segundo factor ya está activado");
  if (estado.tipo !== "sin_segundo_factor") return respuestaDelGuard(estado)!;
  if (!mismoOrigen(req)) return apiError(403, "origen", "Origen no permitido");

  const body = await parseBody(req, cuerpo);
  if (!body.ok) return body.response;

  if (body.data.accion === "iniciar") {
    try {
      const a = await iniciarActivacion(req.headers, body.data.contrasena);
      return Response.json(a, { headers: sinCache });
    } catch {
      return apiError(400, "contrasena", "La contraseña no es correcta");
    }
  }

  try {
    await verificarActivacion(req.headers, body.data.codigo);
  } catch {
    return apiError(400, "codigo", "El código no es válido. Revisa la hora del teléfono y prueba con el siguiente");
  }
  const marcado = await cerrarTrasActivarSegundoFactor(estado.superadmin.userId);
  if (!marcado) return apiError(500, "internal", "No se pudo registrar la activación");
  return Response.json({ ok: true }, { headers: sinCache });
}
