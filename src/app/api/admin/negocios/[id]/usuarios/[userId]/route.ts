import { apiError } from "@/lib/api";
import { errorDelPanel } from "@/server/panel/acciones";
import { quitarUsuarioDesdeElPanel } from "@/server/panel/datos";
import { rutaDelPanel } from "@/server/panel/ruta";

export const dynamic = "force-dynamic";

/**
 * 076 (respuesta 7 de Andres) — `DELETE /api/admin/negocios/:id/usuarios/:userId`:
 * quita una cuenta del personal. Nunca al último dueño (409).
 */
export const DELETE = rutaDelPanel(
  async (_s, _req, { params }: { params: Promise<{ id: string; userId: string }> }) => {
    const { id, userId } = await params;
    try {
      await quitarUsuarioDesdeElPanel(id, userId);
      return Response.json({ ok: true });
    } catch (err) {
      const e = errorDelPanel(err);
      if (e === "no_encontrado") return apiError(404, "not_found", "Esa cuenta no es de ese negocio");
      if (e === "ultimo_dueno") return apiError(409, "ultimo_dueno", "No se puede quitar al último dueño del negocio");
      throw err;
    }
  }
);
