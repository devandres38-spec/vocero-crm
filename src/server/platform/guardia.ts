import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { checkRateLimit, clientIp, llaveFalloPlataforma, rateLimitExcedido, TOKEN_FALLIDO_RATE_LIMIT } from "@/lib/rate-limit";
import { dominioBase, esPlataforma, raizPlataforma, urlDeRaiz } from "@/lib/tenancy";
import { hostDeHeaders, slugDelHost } from "@/server/tenant/host";
import type { Actor } from "@/server/platform/invitaciones";
import { tokenDeHeaders, verificarToken, type Alcance } from "@/server/platform/tokens";
import { esSuperAdmin } from "@/server/tenant/consultas";

/**
 * 069 (FR-006, D13, D14) — La única puerta de `/platform` y
 * `/api/platform/*`: modo plataforma + Super-Admin, por sesión o por token
 * personal `alp_…` (Bearer). Para cualquier otro, 404 (no 403: la superficie
 * no se anuncia). Un token presentado pero inválido es 401: quien lo manda
 * ya sabe que la API existe, y necesita saber que su token no sirve.
 */

export type ActorPlataforma = Actor & { alcances: ReadonlySet<Alcance> };

const TODOS: ReadonlySet<Alcance> = new Set(["read", "provision"]);

async function actorDeSesion(h: Headers): Promise<ActorPlataforma | null> {
  const s = await getAuth().api.getSession({ headers: h });
  if (!s || !(await esSuperAdmin(s.user.id))) return null;
  return { userId: s.user.id, via: "sesion", ip: clientIp(h), alcances: TODOS };
}

export function noEncontrado(): Response {
  return new Response(null, { status: 404 });
}

function json(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export type OpcionesGuardia = {
  scope?: Alcance;
  /** Gestionar tokens solo con sesión: un token no crea ni revoca tokens. */
  soloSesion?: boolean;
  /** Cómo se anota la vía de un token (`api` por defecto; el MCP pasa `mcp`). */
  via?: "api" | "mcp";
  /**
   * Auditoría 070 (M-8) — Con SESIÓN y un método que muta, exigir que
   * `Origin` sea el del panel (el dominio raíz). Los subdominios de los
   * negocios son *same-site* respecto a la raíz: sin esto, una página de un
   * negocio podía hacer que el navegador de un Super-Admin rotara o borrara
   * un cerebro. Con token no aplica (no hay cookie que robar).
   */
  exigirOrigen?: boolean;
};

const METODOS_SEGUROS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Pura: ¿el `Origin` de esta petición es el del panel? */
export function origenDelPanel(req: Request, raiz: { protocolo: string; host: string } | null = raizPlataforma()): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  let esperado: string;
  try {
    esperado = raiz ? `${raiz.protocolo}//${raiz.host}` : new URL(req.url).origin;
    return new URL(origin).origin === new URL(esperado).origin;
  } catch {
    return false;
  }
}

/** Para route handlers. */
export async function requirePlataforma(
  req: Request,
  opciones: OpcionesGuardia = {}
): Promise<{ ok: true; actor: ActorPlataforma } | { ok: false; response: Response }> {
  if (!esPlataforma()) return { ok: false, response: noEncontrado() };
  const ip = clientIp(req.headers);
  const token = tokenDeHeaders(req.headers);

  let actor: ActorPlataforma | null;
  if (token) {
    if (opciones.soloSesion) return { ok: false, response: noEncontrado() };
    // F-04 — La misma cuenta de rechazos por IP que el MCP.
    const llave = llaveFalloPlataforma(ip);
    if (rateLimitExcedido(llave, TOKEN_FALLIDO_RATE_LIMIT)) {
      return { ok: false, response: json(429, "demasiados_intentos", "Demasiados tokens rechazados; espera unos minutos") };
    }
    const v = await verificarToken(token, ip);
    if (!v) {
      checkRateLimit(llave, TOKEN_FALLIDO_RATE_LIMIT);
      return { ok: false, response: json(401, "token_invalido", "Token inválido, vencido o revocado") };
    }
    actor = { userId: v.userId, via: opciones.via ?? "api", tokenId: v.tokenId, ip, alcances: v.scopes };
  } else {
    actor = await actorDeSesion(req.headers);
    if (!actor) return { ok: false, response: noEncontrado() };
    if (opciones.exigirOrigen && !METODOS_SEGUROS.has(req.method.toUpperCase()) && !origenDelPanel(req)) {
      return { ok: false, response: json(403, "origen_invalido", "La petición no viene del panel de la plataforma") };
    }
  }

  if (opciones.scope && !actor.alcances.has(opciones.scope)) {
    return { ok: false, response: json(403, "alcance_insuficiente", `Requiere el alcance ${opciones.scope}`) };
  }
  return { ok: true, actor };
}

/**
 * Pura (staging): qué hacer con una página de `/platform` según el modo, el
 * host, la sesión y el rol.
 * - Fuera de `multi`: 404 (la superficie no existe).
 * - Desde el subdominio de un negocio: a `<raiz>/platform` (el panel vive en
 *   la raíz; las cookies son de un host, la sesión de allá es otra).
 * - Sin sesión: al login (aquí no hay nada que esconder a quien no entró).
 * - Con sesión de alguien que no es Super-Admin: 404.
 */
export type DecisionPagina = { tipo: "pasar" } | { tipo: "404" } | { tipo: "redirigir"; a: string };

export function decidirPaginaPlataforma(d: {
  multi: boolean;
  hostDeNegocio: boolean;
  urlRaizPlatform: string | null;
  sesion: boolean;
  superAdmin: boolean;
}): DecisionPagina {
  if (!d.multi) return { tipo: "404" };
  if (d.hostDeNegocio) return d.urlRaizPlatform ? { tipo: "redirigir", a: d.urlRaizPlatform } : { tipo: "404" };
  if (!d.sesion) return { tipo: "redirigir", a: "/login" };
  return d.superAdmin ? { tipo: "pasar" } : { tipo: "404" };
}

/** Para páginas y layouts de `/platform`. */
export async function requirePlataformaPagina(): Promise<ActorPlataforma> {
  if (!esPlataforma()) notFound();
  const h = await headers();
  const raiz = raizPlataforma();
  const hostDeNegocio = slugDelHost(hostDeHeaders(h), dominioBase()).tipo === "organizacion";
  const s = hostDeNegocio ? null : await getAuth().api.getSession({ headers: h });
  const superAdmin = s ? await esSuperAdmin(s.user.id) : false;
  const d = decidirPaginaPlataforma({
    multi: true,
    hostDeNegocio,
    urlRaizPlatform: raiz ? urlDeRaiz(raiz, "/platform") : null,
    sesion: Boolean(s),
    superAdmin,
  });
  if (d.tipo === "redirigir") redirect(d.a);
  if (d.tipo === "404" || !s) notFound();
  return { userId: s.user.id, via: "sesion", ip: clientIp(h), alcances: TODOS };
}
