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

/**
 * 076 (D16) — Del plugin `twoFactor`, solo quedan abiertas las dos rutas que
 * verifican el código al iniciar sesión. `enable` se abre únicamente por
 * dentro (la ruta del panel, para el superadmin sin segundo factor). Todo lo
 * demás (`disable`, `get-totp-uri`, `generate-backup-codes`, `send-otp`,
 * `verify-otp` y lo que traiga una versión futura) nace cerrado: el segundo
 * factor solo se reinicia con el comando, con la llave del dueño de la base.
 */
export const DOS_FACTORES_ABIERTAS = new Set([
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
]);

export function bloqueoDeRuta(
  path: string,
  interno: boolean
): BloqueoDeAuth | null {
  if (path === "/organization" || path.startsWith("/organization/")) {
    return { status: "NOT_FOUND", message: "No encontrado" };
  }
  if (path === "/two-factor" || path.startsWith("/two-factor/")) {
    if (DOS_FACTORES_ABIERTAS.has(path)) return null;
    if (path === "/two-factor/enable" && interno) return null;
    return { status: "NOT_FOUND", message: "No encontrado" };
  }
  if (path.startsWith("/sign-up") && !interno) {
    return { status: "FORBIDDEN", message: MENSAJE_REGISTRO_CERRADO };
  }
  return null;
}

/**
 * 076 (respuesta 6 de Andres) — Sin «confiar en este dispositivo»: una
 * verificación del segundo factor que lo pida se rechaza entera (no se
 * ignora en silencio), y el código se pide en cada inicio de sesión.
 */
export function pideConfiarDispositivo(path: string, body: unknown): boolean {
  if (!path.startsWith("/two-factor/")) return false;
  const valor = (body as { trustDevice?: unknown } | null | undefined)?.trustDevice;
  return valor !== undefined && valor !== false;
}
