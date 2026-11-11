import { perfilDePrivacidad } from "./repositorio";
import {
  classifyAndMask,
  privacyFlagsOf,
  withoutReview,
  type PrivacyPolicy,
} from "./privacy-filter";

/**
 * 069 — Filtra un texto escrito por un paciente con la política de su negocio.
 * Sin política (no hay perfil legible), el texto no se guarda: queda
 * `[mensaje omitido: no se pudo revisar]` con `sin_revisar`, salvo el rótulo
 * de un botón (`botonId`), que es el título que definió el bot. Igual que en
 * el cerebro (`filtrarMensajes`).
 */
export function filtrarTexto(
  texto: string,
  politica: PrivacyPolicy | null,
  botonId?: string | null
): { text: string; marcas: string[] } {
  const result = politica
    ? classifyAndMask(texto, politica)
    : withoutReview(texto, botonId ?? undefined);
  return { text: result.text, marcas: privacyFlagsOf(result) };
}

/** Une marcas sin repetir, en el orden en que aparecieron. */
export function unirMarcas(...listas: readonly string[][]): string[] {
  return [...new Set(listas.flat())];
}

/**
 * 071 (3.6, D12) — El texto libre que escribe el equipo o el cerebro (notas
 * internas, notas del contacto y de citas, valores de la ficha), filtrado con
 * el perfil del negocio antes de guardarse. Sin perfil legible, queda
 * `[mensaje omitido: no se pudo revisar]` (D3 de la 068). `null` y `undefined`
 * pasan tal cual.
 */
export async function filtrarTextoLibre<T extends string | null | undefined>(
  organizationId: string,
  texto: T
): Promise<T> {
  if (typeof texto !== "string" || !texto) return texto;
  const politica = await perfilDePrivacidad(organizationId);
  return filtrarTexto(texto, politica).text as T;
}
