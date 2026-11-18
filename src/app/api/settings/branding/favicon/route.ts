import { apiError, withAuth } from "@/lib/api";
import { quitarIcono, subirIcono } from "@/server/branding-icono";

export const dynamic = "force-dynamic";

/**
 * Subir el icono de la pestaña. El cuerpo va crudo con su `content-type`, sin
 * multipart: es un archivo suelto y montar un parser de formulario para eso
 * es trabajo que no compra nada. Validación y guardado: `server/branding-icono`
 * (el mismo servicio que usa la ficha del negocio en `/platform`).
 */
export const PUT = withAuth(async (session, req: Request) => {
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede cambiar la marca");
  }
  const r = await subirIcono(session.organizationId, new Uint8Array(await req.arrayBuffer()));
  if (!r.ok) return apiError(r.error.status, r.error.code, r.error.message);
  return Response.json({ favicon: r.favicon });
});

/** Quitar el subido y volver al generado de la marca. */
export const DELETE = withAuth(async (session) => {
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede cambiar la marca");
  }
  await quitarIcono(session.organizationId);
  return Response.json({ favicon: null });
});
