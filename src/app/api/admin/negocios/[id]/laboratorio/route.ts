import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { errorDelPanel } from "@/server/panel/acciones";
import { topeLaboratorioDesdeElPanel } from "@/server/panel/datos";
import { rutaDelPanel } from "@/server/panel/ruta";

export const dynamic = "force-dynamic";

/** 080 (D20, P1) — Cuántas corridas del Laboratorio puede crear un negocio al día. */
const TOPE_MAXIMO = 20;

const cuerpo = z.object({ tope: z.number().int() });

/**
 * `PUT /api/admin/negocios/:id/laboratorio` con `{ tope }`, de 0 a 20 (0 apaga
 * su Laboratorio). Lo escribe `vocero_panel_tope_laboratorio`, que anota en
 * el registro del panel; la app del negocio no tiene permiso sobre la columna.
 */
export const PUT = rutaDelPanel(async (_s, req, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await parseBody(req, cuerpo);
  if (!body.ok) return body.response;
  if (body.data.tope < 0 || body.data.tope > TOPE_MAXIMO) {
    return apiError(422, "tope_invalido", `El tope va de 0 a ${TOPE_MAXIMO} corridas por día`);
  }
  try {
    const tope = await topeLaboratorioDesdeElPanel(id, body.data.tope);
    return Response.json({ tope });
  } catch (err) {
    if (errorDelPanel(err) === "no_encontrado") return apiError(404, "not_found", "Ese negocio no existe");
    throw err;
  }
});
