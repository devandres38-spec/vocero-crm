/**
 * 074 (pilar 1 de Aliantis) — Nadie se da de alta solo: los negocios y sus
 * dueños los crea Andres (`pnpm negocio:alta`, después su panel), y las
 * cuentas de equipo, el dueño desde Ajustes → Equipo (`runInternalSignup`).
 *
 * Antes el registro se abría con la instalación vacía o con `ALLOW_SIGNUP`;
 * las dos puertas se cerraron. Y las rutas propias del plugin `organization`
 * de Better Auth (`/organization/create`, `delete`, `invite-member`…) se
 * saltaban las reglas de roles de la app: se cierran TODAS por prefijo, para
 * que una ruta nueva de una versión futura nazca cerrada.
 */
export type BloqueoDeAuth = {
  status: "FORBIDDEN" | "NOT_FOUND";
  message: string;
};

export const MENSAJE_REGISTRO_CERRADO =
  "El registro está cerrado: las cuentas las crea Aliantis. Si eres parte de un negocio, pide acceso a su dueño.";

export function bloqueoDeRuta(
  path: string,
  interno: boolean
): BloqueoDeAuth | null {
  if (path === "/organization" || path.startsWith("/organization/")) {
    return { status: "NOT_FOUND", message: "No encontrado" };
  }
  if (path.startsWith("/sign-up") && !interno) {
    return { status: "FORBIDDEN", message: MENSAJE_REGISTRO_CERRADO };
  }
  return null;
}
