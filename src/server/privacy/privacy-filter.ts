// 068 — Copia de aliantis-brain/src/privacy/privacy-filter.ts (commit bfa08e2), con el mismo comportamiento:
// la prueba gemela (tests/unit/privacidad-gemela.test.ts) lo comprueba caso por caso.
// Solo cambian las importaciones y no trae privacyPolicyFor (en Vocero la política sale
// del perfil de privacidad registrado: perfil.ts y repositorio.ts). No se edita a mano: un cambio
// se hace en el cerebro, se regeneran los vectores y se copia aquí.
import { findPhoneNumbersInText, type CountryCode } from 'libphonenumber-js/max';
import { findHealthTerms, type HealthCategory, type SensitiveTerms } from './health-terms';
import { normalizeForMatching } from './normalize-text';

// Lo que queda de un mensaje con datos de salud: el texto completo se omite. Enmascarar
// solo las palabras dejaría el contexto ("me ___ la muela desde ayer").
export const HEALTH_OMITTED_TEXT = '[mensaje con información de salud omitido]';

// Lo que queda de un mensaje que no se pudo revisar: sin la configuración no se sabe qué
// términos buscar, y un texto sin revisar no se guarda.
export const UNREVIEWED_TEXT = '[mensaje omitido: no se pudo revisar]';

export type PiiKind = 'correo' | 'tarjeta' | 'telefono' | 'documento';

// Lo que necesita el filtro de cada negocio.
export interface PrivacyPolicy {
  // null: este negocio apagó el filtro de salud. Los datos personales se enmascaran igual.
  terms: SensitiveTerms | null;
  // Nombres y sinónimos de sus servicios: no cuentan como dato de salud aunque contengan un
  // término ("férula para bruxismo").
  allowlist: readonly string[];
  country: CountryCode;
}

export interface PrivacyResult {
  // Lo único que se puede guardar o mandar al LLM.
  text: string;
  // null si no hay datos de salud.
  health: { categories: HealthCategory[]; urgent: boolean } | null;
  // Tipos de datos personales que se enmascararon.
  masked: PiiKind[];
  // true si no hubo con qué revisarlo.
  unreviewed?: boolean;
}

// Las marcas que se guardan con el mensaje; las reglas fijas del turno se guían por ellas.
export function privacyFlagsOf(result: PrivacyResult): string[] {
  if (result.unreviewed) return ['sin_revisar'];
  return result.health ? ['salud', ...result.health.categories] : [...result.masked];
}

// Sin configuración legible. Un botón se guarda igual: su texto es el título que definió el bot,
// y perderlo sería perder un "No acepto".
export function withoutReview(text: string, replyId: string | undefined): PrivacyResult {
  return replyId === undefined
    ? { text: UNREVIEWED_TEXT, health: null, masked: [], unreviewed: true }
    : { text, health: null, masked: [] };
}

// Filtro de privacidad (Ley 1581). Corre sobre cada texto que escribe un paciente, antes de
// guardarlo o procesarlo.
export function classifyAndMask(text: string, policy: PrivacyPolicy): PrivacyResult {
  const categories = policy.terms ? healthCategories(text, policy.terms, policy.allowlist) : [];
  if (categories.length > 0) {
    return {
      text: HEALTH_OMITTED_TEXT,
      health: { categories, urgent: categories.includes('urgencia') },
      masked: [],
    };
  }

  const masked = new Set<PiiKind>();
  let result = text;
  for (const [kind, mask] of MASKERS) {
    const next = mask(result, policy.country);
    if (next !== result) masked.add(kind);
    result = next;
  }
  return { text: result, health: null, masked: [...masked] };
}

function healthCategories(
  text: string,
  terms: SensitiveTerms,
  allowlist: readonly string[],
): HealthCategory[] {
  let normalized = ` ${normalizeForMatching(text)} `;
  // Las frases más largas primero: "ferula para bruxismo" antes que "bruxismo".
  const phrases = allowlist
    .map(normalizeForMatching)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const phrase of phrases) {
    normalized = normalized.split(` ${phrase} `).join('  ');
  }
  const found = findHealthTerms(normalized.trim().replace(/ +/g, ' '), terms);
  return [...new Set(found.map((match) => match.category))];
}

// Número con puntos de miles (1.020.345.678) o seguido (1020345678), que no va pegado a
// un "$" ni a otros dígitos.
const LOOSE_NUMBER = /(?<![$\d.,])(?:\d{1,3}(?:\.\d{3}){2,3}|\d{8,10})(?![\d.,]*\d)/g;

// Cada máscara reemplaza un tipo de dato por su marcador. El orden importa: primero lo
// más específico (un correo puede tener números; una tarjeta parece un documento largo), y
// un documento anunciado antes que un teléfono anunciado ("cédula número 1020345678" es un
// documento aunque diga "número").
const MASKERS: [PiiKind, (text: string, country: CountryCode) => string][] = [
  ['correo', (text) => text.replace(/[^\s@]+@[^\s@]+\.[a-z]{2,}/gi, '[correo]')],
  // Un número internacional con "+" (8 a 15 dígitos, el largo de E.164): es un teléfono,
  // aunque libphonenumber no lo reconozca (el formato mexicano viejo "+52 1 55 1234 5678") y
  // aunque sea tan largo que parezca una tarjeta.
  ['telefono', (text) => text.replace(/\+\d(?:[\p{Zs}\t./()-]{0,2}\d){7,14}\b/gu, '[telefono]')],
  [
    'tarjeta',
    // 13 dígitos o más seguidos (con separadores cortos en la misma línea: espacio, guion,
    // punto, barra) se tapan siempre, sean o no una tarjeta válida. Falla hacia lo seguro:
    // si se exigiera la verificación de Luhn, "4111111111111111 12/27" (tarjeta + fecha)
    // se leería como un solo número inválido y la tarjeta quedaría a la vista. En el chat
    // de un consultorio una cifra así es casi siempre una tarjeta o una cuenta bancaria.
    // \p{Zs}: cualquier espacio horizontal, también el no separable que deja copiar y pegar.
    (text) => text.replace(/\b\d(?:[\p{Zs}\t./-]{0,2}\d){12,}\b/gu, '[tarjeta]'),
  ],
  ['telefono', maskPhones],
  [
    'documento',
    // Después de una palabra que anuncia un documento: un número de 5 a 16 caracteres, o un
    // código de 1 a 3 letras y 5 a 9 dígitos, con una letra al final o sin ella (pasaporte
    // "AB123456", "G12345678"; PPT, PEP; DNI "12345678Z").
    (text) =>
      text.replace(
        /\b(c[eé]dula|c\.?\s?c\.?|documento|doc|t\.?\s?i\.?|tarjeta de identidad|pasaporte|nit|dni|ppt|pep)(\s*(?:(?:es|de|n[uú]mero|no\.?|#|:)\s*){0,3})((?:[a-z]{1,3}\d{5,9}[a-z]?|\d{5,9}[a-z])\b|\d[\d.\s-]{3,14}\d)/gi,
        '$1$2[documento]',
      ),
  ],
  // Después de una palabra que anuncia un teléfono: una cifra de 7 a 15 dígitos, de cualquier
  // país. Sin la palabra, un teléfono de otro país escrito sin "+" pasa: probar varios países
  // tapaba fechas, NIT y guías (limitación conocida, spec 011).
  ['telefono', maskAnnouncedPhones],
  [
    'documento',
    // Sin aviso: un número suelto de 8 a 10 dígitos (con o sin puntos de miles), que es
    // el largo típico de una cédula. Los precios no: llevan "$" o "pesos" y rara vez
    // pasan de 7 dígitos.
    (text) =>
      text.replace(LOOSE_NUMBER, (match, offset: number, whole: string) => {
        const digits = match.replace(/\./g, '').length;
        return digits >= 8 && digits <= 10 && !isPrice(whole, offset + match.length)
          ? '[documento]'
          : match;
      }),
  ],
];

// Lo que sigue a una cifra dice que es plata: "1.200.000 pesos", "350 mil", "50000 cop".
function isPrice(whole: string, end: number): boolean {
  return /^\s*(de\s+)?(pesos|mil|cop)\b/i.test(whole.slice(end));
}

const PHONE_WORD =
  /\b(cel(?:ular)?|tel[eé]fono|tel|m[oó]vil|whats?app|wpp|n[uú]mero|fijo|ll[aá]ma(?:me|nos)?|escr[ií]be(?:me|nos)?|marca(?:me)?|call(?: me)?|phone|number)\b([^\d+$\n(]{0,15})(\(?\d[\d\p{Zs}\t().-]{5,18}\d)/giu;

function maskAnnouncedPhones(text: string): string {
  return text.replace(
    PHONE_WORD,
    (match, word: string, gap: string, number: string, offset: number, whole: string) => {
      const digits = number.replace(/\D/g, '').length;
      const end = offset + match.length;
      // Un precio con puntos de miles (1.200.000), una fecha (15 11 2026, 15/11/2026) o una
      // cifra seguida de "pesos" no son teléfonos. Una cifra suelta de 8 a 10 dígitos la tapa
      // la regla del documento, como antes de esta regla.
      const thousands = /^\d{1,3}(\.\d{3})+$/.test(number);
      const date = /^\d{1,2}[\p{Zs}\t/.-]\d{1,2}[\p{Zs}\t/.-]\d{2,4}$/u.test(number);
      const loose = /^\d{8,10}$/.test(number);
      return digits >= 7 && digits <= 15 && !thousands && !date && !loose && !isPrice(whole, end)
        ? `${word}${gap}[telefono]`
        : match;
    },
  );
}

function maskPhones(text: string, country: CountryCode): string {
  const found = findPhoneNumbersInText(text, country);
  let result = text;
  // De atrás hacia adelante, para que las posiciones sigan valiendo al reemplazar.
  for (const { startsAt, endsAt } of [...found].reverse()) {
    result = `${result.slice(0, startsAt)}[telefono]${result.slice(endsAt)}`;
  }
  return result;
}
