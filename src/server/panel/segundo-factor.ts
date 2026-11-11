import { renderSVG } from "uqr";
import { getAuth, runInternalSignup } from "@/lib/auth";

/**
 * 076 (D16, respuesta 1 de Andres) — Activar el TOTP del superadmin en la web,
 * con un QR. La ruta `/two-factor/enable` de Better Auth está cerrada por
 * HTTP; solo se abre aquí, por dentro (`runInternalSignup`), y la ruta del
 * panel solo llega aquí si el guard dice «superadmin sin segundo factor».
 *
 * El secreto y los códigos de respaldo salen UNA vez, en la respuesta; Better
 * Auth los guarda cifrados con `BETTER_AUTH_SECRET`.
 */

export type Activacion = {
  /** El QR del `otpauth://` como SVG, generado en el servidor. */
  qr: string;
  /** El secreto en texto, por si la app no puede leer el QR. */
  secreto: string;
  codigosDeRespaldo: string[];
};

/** El secreto de un `otpauth://totp/…?secret=…`. */
export function secretoDe(totpUri: string): string {
  try {
    return new URL(totpUri).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

export async function iniciarActivacion(cabeceras: Headers, contrasena: string): Promise<Activacion> {
  const r = await runInternalSignup(() =>
    getAuth().api.enableTwoFactor({
      body: { password: contrasena, issuer: "Aliantis" },
      headers: cabeceras,
    })
  );
  return {
    qr: renderSVG(r.totpURI, { border: 2 }),
    secreto: secretoDe(r.totpURI),
    codigosDeRespaldo: r.backupCodes,
  };
}

/** Verifica el primer código: con una sesión abierta, Better Auth activa el segundo factor. */
export async function verificarActivacion(cabeceras: Headers, codigo: string): Promise<void> {
  await getAuth().api.verifyTOTP({ body: { code: codigo }, headers: cabeceras });
}
