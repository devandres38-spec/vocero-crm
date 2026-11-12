import { apiError, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * 080 (D3 de Aliantis, N9) — Ajustes → IA salió del negocio: la llave de IA es
 * de Aliantis y vive en el entorno. Esta ruta responde 404 a todos (también a
 * `owner` y `admin`); el archivo se borra con la tabla `ai_credentials` en el
 * bloque V.
 */
const fuera = async (_req: Request) => apiError(404, "not_found", "No encontrado");

export const GET = fuera;
// SABOTAJE 5: PUT /api/settings/ai vuelve a responder a un owner.
export const PUT = withAuth(async (session) => {
  if (!canConfigure(session.role)) return apiError(403, "forbidden", "Sin permiso");
  return Response.json({ ok: true });
});
export const DELETE = fuera;
