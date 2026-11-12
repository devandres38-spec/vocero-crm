import { apiError, parseBody } from "@/lib/api";
import { AltaError, datosAlta } from "@/server/auth/alta";
import { altaDesdeElPanel } from "@/server/panel/alta";
import { rutaDelPanel } from "@/server/panel/ruta";

export const dynamic = "force-dynamic";

/**
 * 076 — `POST /api/admin/negocios`: el alta de un negocio desde el panel, con
 * la misma `crearNegocio()` del comando. La contraseña del dueño va SOLO en
 * esta respuesta (sin caché), nunca en una URL ni en el registro.
 */
export const POST = rutaDelPanel(
  async (superadmin, req) => {
    const body = await parseBody(req, datosAlta);
    if (!body.ok) return body.response;
    try {
      const n = await altaDesdeElPanel(superadmin.userId, body.data);
      return Response.json(
        {
          organizationId: n.organizationId,
          userId: n.userId,
          slug: n.slug,
          nombre: n.nombre,
          correo: n.correo,
          contrasena: n.contrasena,
        },
        { status: 201, headers: { "Cache-Control": "no-store" } }
      );
    } catch (err) {
      if (err instanceof AltaError) {
        return err.codigo === "correo_existente"
          ? apiError(409, "correo_existente", err.message)
          : apiError(422, "datos_invalidos", err.message);
      }
      throw err;
    }
  },
  { fueraDelPanel: true }
);
