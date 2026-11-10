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
