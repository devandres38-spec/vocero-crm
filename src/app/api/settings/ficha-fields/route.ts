import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { fichaFieldsSchema } from "@/lib/ficha-campos";
import { fichaFieldsDe, guardarFichaFields, puedeEditarFicha } from "@/server/ficha/esquema";

export const dynamic = "force-dynamic";

/** 072 (FR-013) — Los campos de la ficha de este negocio (`[]` = sin esquema). */
export const GET = withAuth(async (session) => {
  // M-8 (auditoría 072-A) — `puedeEditar` dice lo mismo que el PUT: un acceso
  // de soporte solo lee (esta ruta no está entre las de soporte de configuración).
  return Response.json({
    fields: await fichaFieldsDe(session.organizationId),
    puedeEditar: puedeEditarFicha(session),
  });
});

const cuerpo = z.object({ fields: fichaFieldsSchema }).strict();

/**
 * Reemplaza el esquema completo. Solo quien configura. La clave y el tipo de
 * un campo existente son inmutables (409 `tipo_inmutable`); quitar un campo no
 * borra los valores ya guardados.
 *
 * Un acceso de soporte NO la modifica (las rutas que admiten soporte de
 * configuración son una decisión de producto, `soporte-rutas-configuracion`):
 * la agencia ajusta los campos por el Blueprint (`fichaFields`).
 */
export const PUT = withAuth(async (session, req: Request) => {
  if (!puedeEditarFicha(session)) {
    return apiError(403, "forbidden", "Solo el dueño o un administrador cambia los campos de la ficha");
  }
  const body = await parseBody(req, cuerpo);
  if (!body.ok) return body.response;
  const r = await guardarFichaFields(session.organizationId, body.data.fields);
  if (!r.ok) {
    return apiError(
      409,
      "tipo_inmutable",
      `No se puede cambiar el tipo de un campo existente (${r.claves.join(", ")}). Crea uno con otra clave.`
    );
  }
  return Response.json({ fields: r.fields });
});
