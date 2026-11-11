import { hashPassword } from "better-auth/crypto";
import { contrasenaFuerte } from "@/server/auth/alta";
import { restablecerDesdeElPanel } from "@/server/panel/datos";

/**
 * 076 — Las acciones del panel que necesitan algo más que una función de la
 * base. Corren dentro de `comoPanel` (las llama `rutaDelPanel`).
 */

/**
 * Restablece la contraseña de alguien del personal: una nueva de 24
 * caracteres, devuelta UNA vez para que Andres se la pase. La base solo recibe
 * el hash, marca «debe cambiarla» y cierra sus sesiones (`vocero_panel_restablecer`).
 */
export async function restablecerContrasena(
  organizationId: string,
  userId: string,
  deps: { contrasena?: () => string; hash?: (p: string) => Promise<string> } = {}
): Promise<string> {
  const contrasena = (deps.contrasena ?? contrasenaFuerte)();
  const hash = await (deps.hash ?? hashPassword)(contrasena);
  await restablecerDesdeElPanel(organizationId, userId, hash);
  return contrasena;
}

/**
 * Los errores de las funciones `vocero_panel_*` (Drizzle los envuelve: el
 * código de Postgres viene en `cause`).
 */
export function errorDelPanel(err: unknown): "no_encontrado" | "ultimo_dueno" | null {
  const codigo =
    (err as { code?: unknown })?.code ?? (err as { cause?: { code?: unknown } })?.cause?.code;
  if (codigo === "P0002") return "no_encontrado";
  if (codigo === "23514") return "ultimo_dueno";
  return null;
}
