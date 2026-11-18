/**
 * 068 — La región de la instancia: país, formato regional, moneda y zona.
 *
 * Constitución XI: ningún valor regional se cablea en componentes ni en la
 * lógica; se pregunta aquí. Los defaults son los de Colombia (Aliantis) y cada
 * instancia los cambia por entorno (`REGION_COUNTRY`, `REGION_LOCALE`,
 * `REGION_CURRENCY`, `REGION_TIMEZONE`). La moneda y la zona de cada negocio
 * siguen siendo suyas (Ajustes → Marca y Ajustes → Agenda): esto es solo lo que
 * se usa cuando el negocio no ha dicho nada.
 *
 * Vive en `lib/` sin dependencias de servidor porque los formatters los usan
 * también los componentes de cliente, que reciben el locale por
 * `RegionProvider` (las variables son de runtime, no de build: un
 * `NEXT_PUBLIC_*` quedaría congelado en la imagen).
 *
 * Un valor inválido NO tumba el arranque —como `BRAIN_HEALTH_URL`—: se usa el
 * default y `pnpm doctor` lo avisa (`regionInvalida`).
 */

export type Region = {
  /** ISO 3166-1 alfa-2, para leer teléfonos sin código de país. */
  country: string;
  /** BCP 47, para fechas, horas y números. */
  locale: string;
  /** ISO 4217, la que el tablero suma si el negocio no eligió otra. */
  currency: string;
  /** IANA, la del negocio mientras no configure su agenda. */
  timezone: string;
};

export const REGION_DEFAULTS: Readonly<Region> = Object.freeze({
  country: "CO",
  locale: "es-CO",
  currency: "COP",
  timezone: "America/Bogota",
});

export const REGION_ENV_KEYS = {
  country: "REGION_COUNTRY",
  locale: "REGION_LOCALE",
  currency: "REGION_CURRENCY",
  timezone: "REGION_TIMEZONE",
} as const satisfies Record<keyof Region, string>;

export function esPais(v: string): boolean {
  return /^[A-Z]{2}$/.test(v);
}

export function esLocale(v: string): boolean {
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([v]).length > 0;
  } catch {
    return false;
  }
}

export function esMoneda(v: string): boolean {
  if (!/^[A-Z]{3}$/.test(v)) return false;
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: v });
    return true;
  } catch {
    return false;
  }
}

export function esZonaValida(v: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: v });
    return true;
  } catch {
    return false;
  }
}

const VALIDAR: Record<keyof Region, (v: string) => boolean> = {
  country: esPais,
  locale: esLocale,
  currency: esMoneda,
  timezone: esZonaValida,
};

/**
 * Pura: la región que sale de un entorno, y qué variables traían un valor que
 * no sirve (se ignoran). Un valor vacío cuenta como ausente.
 */
export function resolveRegion(source: Record<string, string | undefined>): {
  region: Region;
  invalidas: string[];
} {
  const region: Region = { ...REGION_DEFAULTS };
  const invalidas: string[] = [];
  for (const campo of Object.keys(REGION_ENV_KEYS) as (keyof Region)[]) {
    const clave = REGION_ENV_KEYS[campo];
    const crudo = source[clave]?.trim();
    if (!crudo) continue;
    const valor = campo === "country" || campo === "currency" ? crudo.toUpperCase() : crudo;
    if (VALIDAR[campo](valor)) region[campo] = valor;
    else invalidas.push(clave);
  }
  return { region, invalidas };
}

let cache: Region | null = null;

/** La región de esta instancia (servidor). Memoizada: el entorno no cambia en runtime. */
export function getRegion(): Region {
  if (cache) return cache;
  const source = typeof process !== "undefined" ? process.env : {};
  cache = resolveRegion(source).region;
  return cache;
}

/** Solo para pruebas. */
export function resetRegionCache(): void {
  cache = null;
}

// --- Formatos -----------------------------------------------------------
// Puros: reciben el locale (y la zona cuando importa). En el cliente salen de
// `useRegion()`; en el servidor, de `getRegion()`.

type Fecha = Date | string | number;

function aFecha(d: Fecha): Date {
  return d instanceof Date ? d : new Date(d);
}

export function formatDate(d: Fecha, locale: string, opts: Intl.DateTimeFormatOptions = {}): string {
  return aFecha(d).toLocaleDateString(locale, opts);
}

export function formatTime(d: Fecha, locale: string, opts: Intl.DateTimeFormatOptions = {}): string {
  return aFecha(d).toLocaleTimeString(locale, opts);
}

export function formatDateTime(
  d: Fecha,
  locale: string,
  opts: Intl.DateTimeFormatOptions = {}
): string {
  return aFecha(d).toLocaleString(locale, opts);
}

export function formatNumber(n: number, locale: string): string {
  return n.toLocaleString(locale);
}

/** Un `Intl.DateTimeFormat` con el locale de la región. */
export function dateTimeFormat(locale: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, opts);
}

/**
 * 069 (auditoría, Fix-B) — Regiones frecuentes para elegir sin escribir
 * (catálogo de la plataforma y selectores de `/platform`), Colombia primero.
 * Cualquier otra combinación válida también sirve.
 */
export const REGIONES_SUGERIDAS = [
  { country: "CO", locale: "es-CO", timezone: "America/Bogota", currency: "COP", label: "Colombia" },
  { country: "MX", locale: "es-MX", timezone: "America/Mexico_City", currency: "MXN", label: "México" },
  { country: "PE", locale: "es-PE", timezone: "America/Lima", currency: "PEN", label: "Perú" },
  { country: "EC", locale: "es-EC", timezone: "America/Guayaquil", currency: "USD", label: "Ecuador" },
  { country: "CL", locale: "es-CL", timezone: "America/Santiago", currency: "CLP", label: "Chile" },
  { country: "AR", locale: "es-AR", timezone: "America/Argentina/Buenos_Aires", currency: "ARS", label: "Argentina" },
  { country: "PA", locale: "es-PA", timezone: "America/Panama", currency: "USD", label: "Panamá" },
  { country: "ES", locale: "es-ES", timezone: "Europe/Madrid", currency: "EUR", label: "España" },
  { country: "US", locale: "es-US", timezone: "America/New_York", currency: "USD", label: "Estados Unidos" },
] as const;
