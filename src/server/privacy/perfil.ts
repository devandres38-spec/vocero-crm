// 068 — Copia de aliantis-brain/src/privacy/perfil-exportado.ts (commit ffb4402): el formato
// del perfil, su esquema y su huella son los mismos en los dos lados. Solo cambian las importaciones
// y no trae perfilExportado (lo arma el cerebro desde su configuración). No se edita a mano.
import { createHash } from 'node:crypto';
import { isSupportedCountry, type CountryCode } from 'libphonenumber-js/max';
import { z } from 'zod';
import { HEALTH_CATEGORIES, isNormalizedTerm, type SensitiveTerms } from './health-terms';
import type { PrivacyPolicy } from './privacy-filter';

// El perfil de privacidad de un negocio, tal como lo exporta el cerebro y lo registra Vocero
// (spec 068 de vocero-crm, contracts/perfil-privacidad.md). Vocero tiene una copia de este
// archivo: el formato y la huella deben ser los mismos en los dos lados.

export const PERFIL_FORMATO = 1;

const PROFILE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const term = z.string().min(1).refine(isNormalizedTerm, {
  error: 'El término debe ir en minúsculas y sin tildes',
});

const sensible = z
  .object({
    urgencia: z.array(term).readonly(),
    sintoma: z.array(term).readonly(),
    condicion: z.array(term).readonly(),
    medicamento: z.array(term).readonly(),
  } satisfies Record<(typeof HEALTH_CATEGORIES)[number], z.ZodType>)
  .strict();

const pais = z.custom<CountryCode>(
  (value) => typeof value === 'string' && isSupportedCountry(value),
  {
    error: 'Código de país de dos letras (ej. CO, MX, US)',
  },
);

export const perfilPrivacidadSchema = z
  .object({
    formato: z.literal(PERFIL_FORMATO),
    perfil: z.string().regex(PROFILE_ID),
    versionPerfil: z.number().int().positive(),
    pais,
    // null: el negocio apagó el filtro de salud (solo con revisión del abogado).
    sensible: sensible.nullable(),
    permitidos: z.array(z.string().trim().min(1)),
    huella: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()
  .refine((perfil) => perfil.huella === huellaDePerfil(perfil), {
    error: 'La huella no cuadra con el contenido: el archivo se cambió después de exportarlo',
    path: ['huella'],
  });

export type PerfilPrivacidad = z.infer<typeof perfilPrivacidadSchema>;

// Lo único que decide el filtro: la huella cubre esto y nada más.
export function huellaDePerfil(perfil: {
  pais: string;
  permitidos: readonly string[];
  sensible: SensitiveTerms | null;
}): string {
  const { pais: country, permitidos, sensible: terms } = perfil;
  return createHash('sha256')
    .update(canonicalJson({ pais: country, permitidos, sensible: terms }))
    .digest('hex');
}

// JSON con las claves de cada objeto ordenadas y sin espacios; las listas conservan su orden.
// La misma regla de canonicalJson en src/config/client-config.ts.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// La política con la que filtra quien registró el perfil (Vocero, o los vectores gemelos).
export function politicaDesdePerfil(perfil: PerfilPrivacidad): PrivacyPolicy {
  return { terms: perfil.sensible, allowlist: perfil.permitidos, country: perfil.pais };
}
