/**
 * 069 — Modo de despliegue (constitución 2.0.0).
 *
 * - `single` (default): una instancia = un negocio, exactamente la 2.8.0.
 * - `multi`: plataforma SaaS. N organizaciones, cada una en
 *   `{slug}.PLATFORM_BASE_DOMAIN`, dadas de alta desde `/platform`.
 *
 * Es el ÚNICO lugar que lee `TENANCY` y sus compañeras. Se lee de
 * `process.env` directo (como `agendaEnabled()`): preguntar por el modo no
 * puede depender de que TODO el entorno valide. Un valor inválido cae a
 * `single` —lo seguro: nada nuevo se enciende— y `pnpm doctor` lo avisa.
 */

export type Tenancy = "single" | "multi";

type Fuente = Record<string, string | undefined>;

const ON_VALUES = new Set(["on", "1", "true", "si", "sí", "yes"]);

export function parseTenancy(raw: string | undefined): { modo: Tenancy; invalida: boolean } {
  const valor = (raw ?? "").trim().toLowerCase();
  if (valor === "" || valor === "single") return { modo: "single", invalida: false };
  if (valor === "multi") return { modo: "multi", invalida: false };
  return { modo: "single", invalida: true };
}

export function tenancy(source: Fuente = process.env): Tenancy {
  return parseTenancy(source.TENANCY).modo;
}

/** Modo plataforma (multi-tenant). */
export function esPlataforma(source: Fuente = process.env): boolean {
  return tenancy(source) === "multi";
}

/**
 * Dominio base normalizado (`aliantis.co`), o null si no hay o no parece un
 * dominio. Se aceptan restos comunes de copiar y pegar (`https://`, `/`
 * final, un punto inicial) para no castigar al operador por ellos.
 */
export function dominioBase(source: Fuente = process.env): string | null {
  const raw = (source.PLATFORM_BASE_DOMAIN ?? "").trim().toLowerCase();
  if (!raw) return null;
  const limpio = raw
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/^\.+|\.+$/g, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(limpio) ? limpio : null;
}

/** Correos de arranque del rol de plataforma, normalizados. */
export function correosSuperAdmin(source: Fuente = process.env): Set<string> {
  return new Set(
    (source.PLATFORM_ADMIN_EMAILS ?? "")
      .split(",")
      .map(normalizarCorreo)
      .filter((c) => c.includes("@"))
  );
}

/** El servidor MCP existe solo en `multi` y con su bandera encendida. */
export function mcpActivo(source: Fuente = process.env): boolean {
  return esPlataforma(source) && ON_VALUES.has((source.PLATFORM_MCP ?? "").trim().toLowerCase());
}

export function normalizarCorreo(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "");
}

/**
 * Subdominios que nunca pueden ser un negocio: los usa la plataforma o
 * confundirían a una persona (`soporte.aliantis.co` debe ser nuestro).
 */
export const SLUGS_RESERVADOS: ReadonlySet<string> = new Set([
  "www",
  "app",
  "api",
  "platform",
  "plataforma",
  "admin",
  "static",
  "assets",
  "mail",
  "email",
  "soporte",
  "support",
  "status",
  "docs",
  "mcp",
  "auth",
  "login",
]);

/** 3–40 caracteres: minúsculas, dígitos y guiones, sin guion en los bordes. */
export const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export type MotivoSlug = "formato" | "reservado" | "guiones";

export function validarSlug(slug: string): { ok: true } | { ok: false; motivo: MotivoSlug } {
  if (!SLUG_REGEX.test(slug)) return { ok: false, motivo: "formato" };
  // `xn--` es punycode y `a--b` se lee mal en una URL.
  if (slug.includes("--")) return { ok: false, motivo: "guiones" };
  if (SLUGS_RESERVADOS.has(slug)) return { ok: false, motivo: "reservado" };
  return { ok: true };
}
