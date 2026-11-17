/**
 * La marca de la plataforma — Aliantis (068; constitución XI).
 *
 * Vive aquí, sin React, porque la usan dos mundos: los componentes (el trazo
 * del panel lateral y del login) y el servidor (el favicon generado que se
 * sirve como texto y el icono de la app). Tener el dibujo en un solo sitio es
 * lo que garantiza que la pestaña y la barra lateral enseñen la MISMA "A".
 *
 * El trazo es una "A" en chevron, sin travesaño: dos piernas que se encuentran
 * arriba. La izquierda se pinta con `currentColor` (hereda el acento, o blanco
 * sobre el mosaico); la derecha es el verde azulado de la marca y NO se
 * recalcula con el acento: es lo que la hace reconocible.
 */

/** Nombre de la plataforma: el que trae una instancia recién instalada. */
export const PLATFORM_BRAND_NAME = "Aliantis";

/** Pierna izquierda de la "A": se pinta con el color del contexto. */
export const BRAND_MARK_LEFT = "M5 20 12 4.5";

/** Pierna derecha de la "A": siempre en el verde azulado de la marca. */
export const BRAND_MARK_RIGHT = "M12 4.5 19 20";

export const BRAND_MARK_STROKE = 3.4;

/** Verde azulado de la marca (pierna derecha), sobre fondos claros. */
export const BRAND_TEAL = "#10C4A5";

/** Sobre el mosaico del acento: el mismo tono, se ve igual de nítido. */
export const BRAND_TEAL_ON_TILE = "#10C4A5";

/**
 * ¿Esta organización lleva el nombre de la plataforma? Solo entonces se dibuja
 * el logo: un negocio que puso su propio nombre no debe ver la "A" de Aliantis
 * en su barra lateral ni en su pestaña, sino su inicial. El nombre por defecto
 * es el de la plataforma, así que una instancia sin configurar lo ve de
 * inmediato.
 */
export function isPlatformBrandName(name: string): boolean {
  return name.trim().toLowerCase() === PLATFORM_BRAND_NAME.toLowerCase();
}
