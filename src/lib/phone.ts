import {
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/min";
import { normalizeMx } from "@/lib/meta/client";

/**
 * 068 — Un teléfono escrito por una PERSONA (alta manual, CSV) a la identidad
 * de WhatsApp: dígitos E.164 sin `+`, la misma forma con la que Meta manda el
 * `wa_id` y con la que el contacto casará cuando escriba.
 *
 * Solo para entrada humana. La identidad de un mensaje entrante (webhooks) NO
 * pasa por aquí: el `wa_id` de Meta ya trae su país y reinterpretarlo con un
 * país por defecto partiría contactos en dos (FR-009).
 *
 * Reglas, en orden:
 * 1. Con `+` o `00` delante, el número dice su país: se acepta si es POSIBLE
 *    en él (longitud plausible).
 * 2. Con 11 dígitos o más, primero se lee como un número que ya trae su código
 *    de país sin `+` («573001234567», «14155552671»): un número nacional de
 *    Colombia tiene 10, así que esa lectura es la natural. Si no es posible
 *    así, se intenta como local.
 * 3. Con 10 o menos, como número LOCAL del país por defecto de la región, y
 *    solo si es VÁLIDO ahí (no basta la longitud). Así «300 123 4567» es un
 *    celular colombiano, pero un «55 1234 5678» mexicano no se convierte en un
 *    número colombiano inventado: diez dígitos son plausibles en muchos
 *    países, y pegarle el 57 a ciegas produciría un contacto que jamás casa.
 *
 * El `521…` mexicano (13 dígitos, con el 1 de móvil que Meta a veces reporta)
 * se canoniza a `52…` ANTES de leerlo: libphonenumber ya no lo reconoce, y es
 * la misma persona.
 *
 * La salida pasa por `normalizeMx` (la canonización `521→52` de siempre), para
 * que un número mexicano siga resolviendo al mismo contacto que antes.
 *
 * Usa los metadatos `min` de libphonenumber-js: librería embebida, sin red
 * (constitución II).
 */

export type TelefonoProblema = "sin_telefono" | "sin_codigo_pais" | "telefono_invalido";

export type TelefonoNormalizado =
  | { ok: true; phone: string }
  | { ok: false; reason: TelefonoProblema };

/** Más que esto no es un E.164 (15 dígitos), por mucho formato que traiga. */
const MAX_DIGITOS = 15;

function aIdentidad(e164: string): string {
  return normalizeMx(e164.replace(/^\+/, ""));
}

export function normalizarTelefonoHumano(
  raw: string,
  paisPorDefecto: string
): TelefonoNormalizado {
  const texto = raw.trim();
  let digitos = texto.replace(/\D/g, "");
  if (!digitos) return { ok: false, reason: "sin_telefono" };

  const internacional = /^(\+|00)/.test(texto);
  if (internacional && texto.startsWith("00")) digitos = digitos.slice(2);
  if (digitos.length > MAX_DIGITOS) return { ok: false, reason: "telefono_invalido" };
  digitos = normalizeMx(digitos);

  const conCodigo = () => {
    const n = parsePhoneNumberFromString(`+${digitos}`);
    return n?.isPossible() ? n : undefined;
  };
  const local = () => {
    const n = parsePhoneNumberFromString(digitos, paisPorDefecto as CountryCode);
    return n?.isValid() ? n : undefined;
  };

  // 1. El número dice su país.
  if (internacional) {
    const n = conCodigo();
    return n ? { ok: true, phone: aIdentidad(n.number) } : { ok: false, reason: "telefono_invalido" };
  }

  // 2. Con código de país sin «+», o local largo.
  if (digitos.length >= 11) {
    const n = conCodigo() ?? local();
    return n ? { ok: true, phone: aIdentidad(n.number) } : { ok: false, reason: "telefono_invalido" };
  }

  // 3. Número local del país de la región, solo si es válido ahí.
  const n = local();
  return n ? { ok: true, phone: aIdentidad(n.number) } : { ok: false, reason: "sin_codigo_pais" };
}

/**
 * Cómo decirle a una persona qué país se asume y con qué código: «57» y
 * «Colombia» para la región por defecto. Sale de la región (constitución XI),
 * no de un texto cableado.
 */
export function paisDeTelefono(country: string, locale: string): { codigo: string; nombre: string } {
  let codigo = "";
  try {
    codigo = getCountryCallingCode(country as CountryCode);
  } catch {
    // País que libphonenumber no conoce: se dice sin código.
  }
  let nombre = country;
  try {
    nombre = new Intl.DisplayNames([locale], { type: "region" }).of(country) ?? country;
  } catch {
    // Runtime sin nombres de regiones: queda el código ISO.
  }
  return { codigo, nombre };
}
