/**
 * 069 — De qué organización es un host, en modo plataforma.
 *
 * `ferreteria-rojas.aliantis.co` → slug `ferreteria-rojas`. El dominio raíz,
 * `www` y cualquier host que no cuelgue del dominio base (localhost, la IP,
 * el healthcheck del contenedor) son «raíz»: ahí la organización sale de la
 * sesión, nunca del host.
 */

export type HostInfo = { tipo: "raiz" } | { tipo: "organizacion"; slug: string };

export function slugDelHost(host: string | null | undefined, base: string | null): HostInfo {
  if (!host || !base) return { tipo: "raiz" };
  const limpio = host.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  if (limpio === base || limpio === `www.${base}`) return { tipo: "raiz" };
  const sufijo = `.${base}`;
  if (!limpio.endsWith(sufijo)) return { tipo: "raiz" };
  const slug = limpio.slice(0, -sufijo.length);
  // Un solo nivel: `a.b.aliantis.co` no es ningún negocio.
  if (!slug || slug.includes(".")) return { tipo: "raiz" };
  return { tipo: "organizacion", slug };
}

/**
 * El host de la petición. `host` es lo que mandó el navegador y lo que
 * Traefik/Caddy preservan; `x-forwarded-host` solo si falta (un cliente
 * puede inventarse ese header si el proxy no lo pisa).
 */
export function hostDeHeaders(h: Pick<Headers, "get">): string | null {
  return h.get("host") ?? h.get("x-forwarded-host");
}
