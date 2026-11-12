import { apiError } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * 080 (D3 de Aliantis, N9) — Ajustes → IA salió del negocio: la llave de IA es
 * de Aliantis y vive en el entorno. Esta ruta responde 404 a todos (también a
 * `owner` y `admin`); el archivo se borra con la tabla `ai_credentials` en el
 * bloque V.
 */
const fuera = async (_req: Request) => apiError(404, "not_found", "No encontrado");

export const GET = fuera;
export const PUT = fuera;
export const DELETE = fuera;
