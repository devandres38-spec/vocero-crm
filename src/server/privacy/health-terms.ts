// 068 — Copia de aliantis-brain/src/privacy/health-terms.ts (commit ffb4402), con el mismo comportamiento:
// la prueba gemela (tests/unit/privacidad-gemela.test.ts) lo comprueba caso por caso.
// Solo cambian las importaciones. No se edita a mano: un cambio
// se hace en el cerebro, se regeneran los vectores y se copia aquí.
import { normalizeForMatching } from './normalize-text';

// Términos que indican que alguien habla de su salud (Ley 1581: dato sensible). Si aparece
// alguno, el bot no procesa el mensaje: responde una frase fija y deriva.
//
// Las listas son datos: están en perfiles/listas/ y cada perfil elige las suyas. Cómo se
// escriben: ya normalizados (minúsculas, sin tildes). Un "*" al final cubre cualquier palabra
// que empiece así ("inflam*": inflamado, inflamación). Las frases se comparan palabra por
// palabra. Ante la duda se incluye el término: derivar de más es molesto; dejar pasar un dato
// de salud es un incumplimiento.
export const HEALTH_CATEGORIES = ['urgencia', 'sintoma', 'condicion', 'medicamento'] as const;

export type HealthCategory = (typeof HEALTH_CATEGORIES)[number];
export type SensitiveTerms = Record<HealthCategory, readonly string[]>;

export interface HealthMatch {
  category: HealthCategory;
  term: string;
}

// Términos de salud presentes en un texto ya normalizado (normalizeForMatching).
export function findHealthTerms(normalizedText: string, terms: SensitiveTerms): HealthMatch[] {
  const words = normalizedText.split(' ').filter(Boolean);
  return HEALTH_CATEGORIES.flatMap((category) =>
    terms[category].filter((term) => containsTerm(words, term)).map((term) => ({ category, term })),
  );
}

function containsTerm(words: string[], term: string): boolean {
  const termWords = term.split(' ');
  for (let start = 0; start + termWords.length <= words.length; start++) {
    if (termWords.every((termWord, i) => wordMatches(words[start + i] ?? '', termWord))) {
      return true;
    }
  }
  return false;
}

function wordMatches(word: string, termWord: string): boolean {
  return termWord.endsWith('*') ? word.startsWith(termWord.slice(0, -1)) : word === termWord;
}

// Un término está bien escrito si ya está normalizado: si no, nunca coincidiría.
// El "*" puede ir al final de cualquier palabra de la frase ("diente* picad*").
export function isNormalizedTerm(term: string): boolean {
  const withoutWildcards = term.replace(/\*(?= |$)/g, '');
  return (
    !withoutWildcards.includes('*') && normalizeForMatching(withoutWildcards) === withoutWildcards
  );
}
