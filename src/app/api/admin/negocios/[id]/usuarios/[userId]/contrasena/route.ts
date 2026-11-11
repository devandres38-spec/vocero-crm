import { apiError } from "@/lib/api";
import { errorDelPanel, restablecerContrasena } from "@/server/panel/acciones";
import { rutaDelPanel } from "@/server/panel/ruta";

export const dynamic = "force-dynamic";

/**
 * 076 (respuesta 7 de Andres) — `POST /api/admin/negocios/:id/usuarios/:userId/contrasena`:
 * una contraseña nueva, devuelta UNA vez (sin caché). Su dueño debe cambiarla
 * al entrar, y sus sesiones se cierran.
 */
export const POST = rutaDelPanel(
  async (_s, _req, { params }: { params: Promise<{ id: string; userId: string }> }) => {
    const { id, userId } = await params;
    try {
      const contrasena = await restablecerContrasena(id, userId);
      return Response.json({ contrasena }, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      if (errorDelPanel(err) === "no_encontrado") {
        return apiError(404, "not_found", "Esa cuenta no es de ese negocio");
      }
      throw err;
    }
  }
);
