/**
 * Limitación de tasa in-process por clave (IP) con ventana deslizante
 * (FR-062). Suficiente para el monolito de una instancia; sin Redis
 * (Constitución II).
 */

type Bucket = {
  /** timestamps (ms) de los intentos */
  hits: number[];
  /** la ventana con la que se llenó: el barrido la necesita */
  windowMs: number;
};

const globalForRl = globalThis as unknown as {
  __voceroRateLimit?: Map<string, Bucket>;
};

function store(): Map<string, Bucket> {
  if (!globalForRl.__voceroRateLimit) {
    globalForRl.__voceroRateLimit = new Map();
  }
  return globalForRl.__voceroRateLimit;
}

/**
 * Las llaves son por IP en superficies públicas (login, `/api/bot/*`): quien
 * rote IPs —o falsee `x-forwarded-for` si la app queda sin proxy— estrena una
 * llave por request. Sin barrido, el mapa crecería para siempre; con él, la
 * memoria queda acotada por el tráfico de la última ventana.
 */
const SWEEP_AT = 10_000;
/**
 * Auditoría 070 (A-1) — Tope DURO de llaves. El barrido solo borra lo
 * vencido: rotando IPs falsas dentro de la ventana, el mapa crecía sin
 * límite (OOM). Pasado el tope se desaloja la llave más antigua (el `Map`
 * conserva el orden de inserción).
 */
export const MAX_KEYS = 50_000;
let lastSweep = 0;

function hacerSitio(buckets: Map<string, Bucket>, key: string): void {
  if (buckets.has(key)) return;
  while (buckets.size >= MAX_KEYS) {
    const masVieja = buckets.keys().next().value;
    if (masVieja === undefined) return;
    buckets.delete(masVieja);
  }
}

function sweep(buckets: Map<string, Bucket>, now: number): void {
  if (buckets.size < SWEEP_AT || now - lastSweep < 1000) return;
  lastSweep = now;
  for (const [key, b] of buckets) {
    const last = b.hits[b.hits.length - 1] ?? 0;
    if (last <= now - b.windowMs) buckets.delete(key);
  }
}

export type RateLimitResult = { allowed: boolean; remaining: number };

export function checkRateLimit(
  key: string,
  opts: { windowMs: number; max: number },
  now: number = Date.now()
): RateLimitResult {
  const buckets = store();
  sweep(buckets, now);
  const cutoff = now - opts.windowMs;
  const hits = (buckets.get(key)?.hits ?? []).filter((t) => t > cutoff);

  hacerSitio(buckets, key);
  if (hits.length >= opts.max) {
    buckets.set(key, { hits, windowMs: opts.windowMs });
    return { allowed: false, remaining: 0 };
  }
  hits.push(now);
  buckets.set(key, { hits, windowMs: opts.windowMs });
  return { allowed: true, remaining: opts.max - hits.length };
}

/**
 * Auditoría final 069 (F-04) — ¿Esta llave ya agotó su ventana? Mira sin
 * contar el intento: sirve para frenar ANTES de consultar la base a quien
 * acumula fallos (tokens inválidos), contando solo cuando falla.
 */
export function rateLimitExcedido(
  key: string,
  opts: { windowMs: number; max: number },
  now: number = Date.now()
): boolean {
  const cutoff = now - opts.windowMs;
  const hits = (store().get(key)?.hits ?? []).filter((t) => t > cutoff);
  return hits.length >= opts.max;
}

/** F-04 — Tokens `alp_` rechazados (401) por IP: 20 en 10 minutos. */
export const TOKEN_FALLIDO_RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 20 };

/**
 * Auditoría 070 (A-1, C-1) — Las llaves de fallos, separadas por superficie:
 * un ataque a una ya no bloquea la otra.
 */
export const llaveFalloPlataforma = (ip: string) => `platform-token-fail:${ip}`;

/**
 * Credenciales de cerebro rechazadas por (IP, organización): 20 en 10 min.
 * TODOS los negocios de una Nea `multiorg` salen por la misma IP; contar
 * solo por IP dejaba que un negocio reasignado (401 en bucle) tumbara a los
 * demás con 429.
 */
export const BRAIN_FALLO_ORG_RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 20 };
/** Y un tope por IP más holgado, para quien prueba muchas organizaciones. */
export const BRAIN_FALLO_IP_RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 300 };
export const llaveFalloCerebro = (ip: string, org: string) => `brain-auth-fail:${ip}:${org.slice(0, 128)}`;
export const llaveFalloCerebroIp = (ip: string) => `brain-auth-fail-ip:${ip}`;

/** F-04 — Pases de sesión: 10 por minuto por persona y 30 por IP. */
export const PASE_RATE_LIMIT = { windowMs: 60 * 1000, max: 10 };
export const PASE_IP_RATE_LIMIT = { windowMs: 60 * 1000, max: 30 };

/**
 * Auditoría 070 (A-1) — Cuántos proxies de confianza hay delante
 * (`TRUSTED_PROXY_HOPS`, por defecto 1: Traefik/Coolify o Caddy).
 */
export function saltosDeProxy(env: Record<string, string | undefined> = process.env): number {
  const n = Number.parseInt(env.TRUSTED_PROXY_HOPS ?? "", 10);
  return Number.isFinite(n) && n >= 0 && n <= 10 ? n : 1;
}

/**
 * La IP del cliente para LIMITAR, jamás para autorizar.
 *
 * Auditoría 070 (A-1): se lee `x-forwarded-for` desde la DERECHA. Cada
 * proxy AÑADE al final la IP que vio, así que lo de la izquierda lo escribe
 * el cliente y se puede falsear (antes se tomaba el primero: rotándolo se
 * evadía cualquier límite). Con N proxies de confianza, la IP real es la
 * N-ésima desde la derecha. Sin `x-forwarded-for`, `x-real-ip`; sin nada,
 * "local".
 */
export function clientIp(headers: Headers | null | undefined, saltos: number = saltosDeProxy()): string {
  const cadena = (headers?.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (saltos > 0 && cadena.length > 0) {
    return cadena[Math.max(0, cadena.length - saltos)]!;
  }
  return headers?.get("x-real-ip")?.trim() || "local";
}

/** Solo para tests. */
export function resetRateLimit(): void {
  store().clear();
  lastSweep = 0;
}

/** Solo para tests: cuántas llaves vivas guarda el limitador. */
export function rateLimitKeys(): number {
  return store().size;
}

/** 10 intentos / 10 minutos por IP en login y registro (FR-062). */
export const AUTH_RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 10 };
