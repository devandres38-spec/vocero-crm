import { getSessionOrNull } from "@/lib/auth/session";
import { conNegocio } from "@/lib/db/contexto";
import { aparienciaActual } from "@/server/apariencia";
import { getBrandingContext } from "@/server/branding";

/**
 * 075 — La marca y la apariencia de ESTA petición: las del negocio de la
 * sesión, o las de por defecto sin sesión (login, pantallas públicas). Nunca
 * las de otro negocio. Para el layout raíz, el manifiesto y los iconos, que
 * antes tomaban «la primera organización de la tabla» para todos.
 */
export async function marcaDeLaPeticion(): Promise<Awaited<ReturnType<typeof getBrandingContext>>> {
  const session = await getSessionOrNull();
  if (!session) return getBrandingContext(null);
  return conNegocio(session.organizationId, () => getBrandingContext(session.organizationId));
}

export async function aparienciaDeLaPeticion(): Promise<Awaited<ReturnType<typeof aparienciaActual>>> {
  const session = await getSessionOrNull();
  if (!session) return aparienciaActual(null);
  return conNegocio(session.organizationId, () => aparienciaActual(session.organizationId));
}
