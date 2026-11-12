// 081 — Copia de aliantis-brain/src/privacy/phonetic.ts (commit 452597b), con el mismo comportamiento:
// la prueba gemela (tests/unit/privacidad-gemela.test.ts) lo comprueba caso por caso.
// Solo cambian las importaciones. No se edita a mano: un cambio
// se hace en el cerebro, se regeneran los vectores y se copia aquí.
// Cómo suena y qué tan lejos está una palabra escrita por una persona (spec 015, D1; spec 016, D1).
//
// Trabaja sobre texto ya pasado por normalizeForMatching (minúsculas, sin tildes ni signos) y solo
// sirve para comparar. Vive en privacidad porque es la capa de abajo: la usan el filtro de salud
// (health-terms.ts) y la conversación (conversation/colloquial.ts), y Vocero tiene una copia para
// su filtro gemelo.

// La clave fonética de una palabra normalizada: lo que en Colombia suena igual se escribe igual
// ("kiero" = "quiero"). El orden importa:
// - "cc" → "ks" antes que la "c" suelta ("accion" → "aksion");
// - "ch" se aparta con una marca para que su "h" no se borre ni su "c" pase a "k";
// - "g" antes de "e"/"i" pasa a "j" antes de quitar la "u" de "gue"/"gui" ("guerra" no es "jerra");
// - "n" antes de "b" pasa a "m" después de igualar "v" con "b" ("enviar" = "embiar");
// - al final, las letras dobles quedan en una ("ck" → "kk" → "k", "rr" → "r").
export function phoneticKey(word: string): string {
  return word
    .replace(/cc/g, 'ks')
    .replace(/ch/g, 'C')
    .replace(/ll/g, 'y')
    .replace(/qu(?=[ei])/g, 'k')
    .replace(/q/g, 'k')
    .replace(/c(?=[ei])/g, 's')
    .replace(/c/g, 'k')
    .replace(/[zx]/g, 's')
    .replace(/g(?=[ei])/g, 'j')
    .replace(/gu(?=[ei])/g, 'g')
    .replace(/h/g, '')
    .replace(/[vw]/g, 'b')
    .replace(/n(?=b)/g, 'm')
    .replace(/(.)\1+/g, '$1')
    .replace(/C/g, 'ch');
}

// Distancia de Damerau (cambiar, quitar, agregar o trasponer letras vecinas; versión OSA).
export function editDistance(a: string, b: string): number {
  // Tabla plana: la celda (i, j) está en i * cols + j.
  const cols = b.length + 1;
  const d = new Array<number>((a.length + 1) * cols).fill(0);
  const at = (i: number, j: number) => d[i * cols + j] ?? 0;
  for (let i = 0; i <= a.length; i++) d[i * cols] = i;
  for (let j = 0; j <= b.length; j++) d[j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, at(i - 2, j - 2) + 1);
      }
      d[i * cols + j] = best;
    }
  }
  return at(a.length, b.length);
}
