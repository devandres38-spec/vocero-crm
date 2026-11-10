// 068 — Copia de aliantis-brain/src/privacy/normalize-text.ts (commit ffb4402), con el mismo comportamiento:
// la prueba gemela (tests/unit/privacidad-gemela.test.ts) lo comprueba caso por caso.
// Solo cambian las importaciones. No se edita a mano: un cambio
// se hace en el cerebro, se regeneran los vectores y se copia aquí.
// Lleva un texto escrito por una persona a una forma estándar para compararlo con listas
// de términos: "¡Me DUELEEEE la múela!!" → "me duele la muela".
// - minúsculas y sin tildes (la ñ queda como n: solo se usa para comparar, nunca se guarda);
// - una letra repetida 3 o más veces queda en una ("dueleee" → "duele"; "llamar" no cambia);
// - signos y emojis se vuelven espacios, y los espacios se juntan;
// - letras "decoradas" de algunos teclados (negrita matemática, ancho completo) pasan a
//   letras normales (NFKC), y los caracteres invisibles de formato (espacio de ancho cero,
//   guion suave: categoría Unicode Cf) se borran. Si se volvieran espacio, "du" + invisible
//   + "ele" quedaría en "du ele" y el dato de salud se escaparía del filtro. Los selectores
//   de variante son marcas (\p{M}) y se borran junto con las tildes.
export function normalizeForMatching(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/([a-z])\1{2,}/g, '$1')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
