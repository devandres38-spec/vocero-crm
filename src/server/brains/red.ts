import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Auditoría 070 (A-2) — A dónde NO puede apuntar un cerebro (SSRF).
 *
 * El CRM le hace peticiones a la URL que registra el Super-Admin (despacho,
 * aviso de borrado, `/health`). Se bloquea lo que nunca es un cerebro y sí un
 * blanco clásico: loopback, `0.0.0.0/8`, link-local y metadatos de nube
 * (`169.254.0.0/16`, `fe80::/10`, `fd00:ec2::254`, `metadata.google.internal`),
 * multicast y difusión — también en su forma IPv6 mapeada
 * (`[::ffff:169.254.169.254]`).
 *
 * Las redes PRIVADAS (RFC 1918, ULA, nombres de Docker como `nea`) siguen
 * permitidas a propósito: es donde vive Nea junto al CRM en Coolify/Compose.
 *
 * Contra DNS rebinding, `verificarDestino` resuelve el nombre JUSTO antes de
 * conectar y rechaza si cualquiera de sus IPs está bloqueada.
 */

const NOMBRES_BLOQUEADOS = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "instance-data.ec2.internal",
  "metadata.azure.internal",
]);

function ipv4ANumero(ip: string): number | null {
  const p = ip.split(".");
  if (p.length !== 4) return null;
  let n = 0;
  for (const x of p) {
    if (!/^\d{1,3}$/.test(x)) return null;
    const v = Number(x);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

function enRango(n: number, base: string, bits: number): boolean {
  const b = ipv4ANumero(base)!;
  const mascara = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((n & mascara) >>> 0) === ((b & mascara) >>> 0);
}

function ipv4Bloqueada(ip: string): boolean {
  const n = ipv4ANumero(ip);
  if (n === null) return true;
  return (
    enRango(n, "0.0.0.0", 8) ||
    enRango(n, "127.0.0.0", 8) ||
    enRango(n, "169.254.0.0", 16) ||
    enRango(n, "224.0.0.0", 4) ||
    enRango(n, "240.0.0.0", 4) ||
    n === ipv4ANumero("100.100.100.200") // metadatos de Alibaba Cloud
  );
}

/** Expande una IPv6 a sus 8 grupos de 16 bits (o `null` si no es válida). */
function gruposIpv6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zona = s.indexOf("%");
  if (zona >= 0) s = s.slice(0, zona);
  // Sufijo IPv4 (`::ffff:1.2.3.4`) → dos grupos.
  const ultimo = s.lastIndexOf(":");
  const cola = s.slice(ultimo + 1);
  if (cola.includes(".")) {
    const n = ipv4ANumero(cola);
    if (n === null) return null;
    s = `${s.slice(0, ultimo + 1)}${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [izq, der, sobra] = s.split("::");
  if (sobra !== undefined) return null;
  const a = izq ? izq.split(":") : [];
  const b = der !== undefined ? (der ? der.split(":") : []) : [];
  if (der === undefined && a.length !== 8) return null;
  const faltan = 8 - a.length - b.length;
  if (faltan < 0) return null;
  const todos = [...a, ...Array(der !== undefined ? faltan : 0).fill("0"), ...b];
  if (todos.length !== 8) return null;
  const g = todos.map((x) => (/^[0-9a-f]{1,4}$/.test(x) ? Number.parseInt(x, 16) : Number.NaN));
  return g.some((x) => Number.isNaN(x)) ? null : g;
}

function ipv6Bloqueada(ip: string): boolean {
  const g = gruposIpv6(ip);
  if (!g) return true;
  const ceros = (desde: number, hasta: number) => g.slice(desde, hasta).every((x) => x === 0);
  // IPv4 mapeada (::ffff:a.b.c.d) o compatible (::a.b.c.d): se juzga la IPv4.
  if (ceros(0, 5) && (g[5] === 0xffff || g[5] === 0) && !(g[5] === 0 && g[6] === 0)) {
    const v4 = `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`;
    return ipv4Bloqueada(v4);
  }
  if (ceros(0, 7) && (g[7] === 0 || g[7] === 1)) return true; // :: y ::1
  if ((g[0]! & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0]! & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  // fd00:ec2::254 (metadatos de AWS por IPv6)
  if (g[0] === 0xfd00 && g[1] === 0x0ec2 && ceros(2, 7) && g[7] === 0x254) return true;
  return false;
}

/** ¿Esta IP literal está prohibida como destino de un cerebro? */
export function ipBloqueada(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return ipv4Bloqueada(ip);
  if (v === 6) return ipv6Bloqueada(ip);
  return true;
}

/** Pura: por qué este host no sirve (nombre o IP literal), o `null`. */
export function hostBloqueado(hostname: string): string | null {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (!h) return "host_vacio";
  if (NOMBRES_BLOQUEADOS.has(h) || h.endsWith(".localhost")) return "host_reservado";
  if (isIP(h)) return ipBloqueada(h) ? "ip_reservada" : null;
  return null;
}

type Lookup = (host: string) => Promise<{ address: string }[]>;
const lookupReal: Lookup = (host) => dnsLookup(host, { all: true, verbatim: true });

/**
 * Justo antes de conectar: el host y TODAS sus IPs resueltas deben estar
 * permitidas. `null` = adelante; si no, el motivo (para el log y la UI).
 */
export async function verificarDestino(url: string, lookup: Lookup = lookupReal): Promise<string | null> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "url_invalida";
  }
  const motivo = hostBloqueado(u.hostname);
  if (motivo) return motivo;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return null;
  try {
    const ips = await lookup(host);
    if (ips.length === 0) return "no_resuelve";
    return ips.some((d) => ipBloqueada(d.address)) ? "ip_reservada" : null;
  } catch {
    return "no_resuelve";
  }
}
