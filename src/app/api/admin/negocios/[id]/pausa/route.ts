import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { errorDelPanel } from "@/server/panel/acciones";
import { negociosDelPanel, pausarDesdeElPanel } from "@/server/panel/datos";
import { rutaDelPanel } from "@/server/panel/ruta";

export const dynamic = "force-dynamic";

/**
 * 076 (respuesta 2 de Andres) — `POST /api/admin/negocios/:id/pausa`:
 * `{ pausar, confirmacion }`, con el nombre del negocio escrito como
 * confirmación. Pausar cierra las sesiones de su personal.
 */
const cuerpo = z.object({ pausar: z.boolean(), confirmacion: z.string().max(200) });

export const POST = rutaDelPanel(async (_s, req, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await parseBody(req, cuerpo);
  if (!body.ok) return body.response;
  const negocio = (await negociosDelPanel()).find((n) => n.id === id);
  if (!negocio) return apiError(404, "not_found", "Ese negocio no existe");
  if (body.data.confirmacion.trim() !== negocio.nombre.trim()) {
    return apiError(422, "confirmacion", "Escribe el nombre exacto del negocio para confirmar");
  }
  try {
    const pausadoEn = await pausarDesdeElPanel(id, body.data.pausar);
    return Response.json({ pausadoEn });
  } catch (err) {
    if (errorDelPanel(err) === "no_encontrado") return apiError(404, "not_found", "Ese negocio no existe");
    throw err;
  }
});
