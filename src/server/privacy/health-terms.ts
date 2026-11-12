// 068 y 081 — Copia de aliantis-brain/src/privacy/health-terms.ts (commit 452597b), con el mismo comportamiento:
// la prueba gemela (tests/unit/privacidad-gemela.test.ts) lo comprueba caso por caso.
// Solo cambian las importaciones. No se edita a mano: un cambio
// se hace en el cerebro, se regeneran los vectores y se copia aquí.
import { normalizeForMatching } from './normalize-text';
import { PALABRAS_REALES, SUENAN_SIN_SER_SALUD } from './palabras-reales';
import { editDistance, phoneticKey } from './phonetic';

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

// Términos de salud presentes en un texto ya normalizado (normalizeForMatching), también mal
// escritos (spec 016: ver `tolerance`, abajo).
export function findHealthTerms(normalizedText: string, terms: SensitiveTerms): HealthMatch[] {
  const words = normalizedText.split(' ').filter(Boolean).map(writtenWord);
  return HEALTH_CATEGORIES.flatMap((category) =>
    terms[category].filter((term) => containsTerm(words, term)).map((term) => ({ category, term })),
  );
}

function containsTerm(words: WrittenWord[], term: string): boolean {
  const termWords = term.split(' ');
  for (let start = 0; start + termWords.length <= words.length; start++) {
    if (termWords.every((termWord, i) => wordMatches(words[start + i], termWord))) {
      return true;
    }
  }
  return false;
}

function wordMatches(word: WrittenWord | undefined, termWord: string): boolean {
  return word !== undefined && tolerance(word, termWord, PROTECTED) !== null;
}

// Un término está bien escrito si ya está normalizado: si no, nunca coincidiría.
// El "*" puede ir al final de cualquier palabra de la frase ("diente* picad*").
export function isNormalizedTerm(term: string): boolean {
  const withoutWildcards = term.replace(/\*(?= |$)/g, '');
  return (
    !withoutWildcards.includes('*') && normalizeForMatching(withoutWildcards) === withoutWildcards
  );
}

// Errores de escritura (spec 016, D2): "infesion", "dolr", "inchada", "embarasada" también son
// salud. Las reglas son del idioma, no de un nicho, y fallan hacia lo seguro sin tapar palabras
// normales: lo que suena igual cuenta, salvo unas pocas palabras reales de familias que no son de
// salud; una letra de más, de menos o cambiada solo cuenta si la palabra escrita no existe en
// español (palabras-reales.ts, generado con estas mismas reglas).
//
// Cambiar una regla, un umbral o las familias obliga a regenerar palabras-reales.ts
// (npm run privacidad:vecinas): su huella incluye esta versión y las familias.
export const REGLAS_TOLERANCIA = 1;

// Menos de 4 letras, solo exacta: "tos" no es "dos", "pus" no es "pues".
const MIN_TOLERANT_LENGTH = 4;
// Una edición: desde 6 letras si el término es una palabra entera; desde 7 si es una raíz con
// "*", contra el principio de la palabra y con una cola de máximo 5 letras. Las raíces de 6
// ("inflam*", "desmay*", "punzad*") solo se reconocen por sonido: eran las que más chocaban.
const MIN_EDIT_WORD = 6;
const MIN_EDIT_STEM = 7;
const MAX_EDIT_TAIL = 5;
// Una letra omitida por dentro, en términos de 5 letras ("dolr" → "dolor*"); cola de máximo 3.
const OMISSION_LENGTH = 5;
const MAX_OMISSION_TAIL = 3;
// Una letra cortada al final, en términos sin "*" desde 7 letras ("ibuprofen").
const MIN_CUT_LENGTH = 7;
// Familias de palabras reales que suenan como un término y no son salud: "se deprecia" y "la
// embarraste" ("embarrarla", muy colombiano). Se protegen solo las palabras del diccionario
// (SUENAN_SIN_SER_SALUD), no el comienzo: "deprecion" y "embarrazada" siguen siendo salud.
export const NOT_HEALTH_FAMILIES: readonly string[] = ['depreci', 'embarr'];

export type Tolerance = 'exacta' | 'sonido' | 'edicion' | 'omision' | 'corte';

// Las palabras reales que no se toman como un término: las que existen en español, ante una
// edición, omisión o corte; y las de NOT_HEALTH_FAMILIES, ante el sonido.
export interface ProtectedWords {
  readonly real: ReadonlySet<string>;
  readonly soundAlike: ReadonlySet<string>;
}

export const PROTECTED: ProtectedWords = {
  real: PALABRAS_REALES,
  soundAlike: SUENAN_SIN_SER_SALUD,
};

// Una palabra escrita, con su clave de salud calculada una sola vez.
export interface WrittenWord {
  readonly text: string;
  readonly key: string;
}

interface TermWord {
  readonly base: string;
  readonly stem: boolean;
  readonly key: string;
}

// La clave fonética, más "n" antes de "p" o "f" → "m" ("imflamada" = "inflamada"). Solo aquí:
// la conversación sigue con phoneticKey tal cual.
function healthKey(word: string): string {
  return phoneticKey(word).replace(/n(?=[pf])/g, 'm');
}

export function writtenWord(text: string): WrittenWord {
  return { text, key: healthKey(text) };
}

// Las palabras de los términos son pocas (las de las listas): su clave se guarda.
const termWords = new Map<string, TermWord>();

function termWord(term: string): TermWord {
  let found = termWords.get(term);
  if (!found) {
    const stem = term.endsWith('*');
    const base = stem ? term.slice(0, -1) : term;
    found = { base, stem, key: healthKey(base) };
    termWords.set(term, found);
  }
  return found;
}

// Cómo coincide una palabra escrita con una palabra de un término, o null.
export function tolerance(
  written: WrittenWord,
  term: string,
  protectedWords: ProtectedWords,
): Tolerance | null {
  const t = termWord(term);
  const { text, key } = written;
  if (t.stem ? text.startsWith(t.base) : text === t.base) return 'exacta';
  if (text.length < MIN_TOLERANT_LENGTH || t.base.length < MIN_TOLERANT_LENGTH) return null;
  if (t.stem ? key.startsWith(t.key) : key === t.key) {
    return protectedWords.soundAlike.has(text) ? null : 'sonido';
  }
  if (!key.startsWith(t.key.charAt(0)) || protectedWords.real.has(text)) return null;
  return t.stem ? stemTypo(key, t) : wordTypo(key, t);
}

function wordTypo(key: string, t: TermWord): Tolerance | null {
  if (t.base.length >= MIN_EDIT_WORD && sameEnd(key, t.key) && editDistance(key, t.key) === 1) {
    return 'edicion';
  }
  if (t.base.length === OMISSION_LENGTH && isInnerOmission(key, t.key)) return 'omision';
  if (t.base.length >= MIN_CUT_LENGTH && key.length === t.key.length - 1 && t.key.startsWith(key)) {
    return 'corte';
  }
  return null;
}

// Contra el principio de la palabra, con el largo de la raíz, uno menos o uno más.
function stemTypo(key: string, t: TermWord): Tolerance | null {
  for (const length of [t.key.length - 1, t.key.length, t.key.length + 1]) {
    if (key.length < length) continue;
    const piece = key.slice(0, length);
    const tail = key.length - length;
    if (
      t.base.length >= MIN_EDIT_STEM &&
      tail <= MAX_EDIT_TAIL &&
      sameEnd(piece, t.key) &&
      editDistance(piece, t.key) === 1
    ) {
      return 'edicion';
    }
    if (
      t.base.length === OMISSION_LENGTH &&
      tail <= MAX_OMISSION_TAIL &&
      isInnerOmission(piece, t.key)
    ) {
      return 'omision';
    }
  }
  return null;
}

// La edición no cambia la última letra: "hincha" no es "hinchad", "corto" no es "corte".
function sameEnd(a: string, b: string): boolean {
  return a.at(-1) === b.at(-1);
}

// `piece` es `key` sin una letra de adentro (ni la primera ni la última).
function isInnerOmission(piece: string, key: string): boolean {
  if (piece.length !== key.length - 1) return false;
  for (let i = 1; i < key.length - 1; i++) {
    if (key.slice(0, i) + key.slice(i + 1) === piece) return true;
  }
  return false;
}
