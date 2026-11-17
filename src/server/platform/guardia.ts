import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { clientIp } from "@/lib/rate-limit";
import { esPlataforma } from "@/lib/tenancy";
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
};

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
    const v = await verificarToken(token, ip);
    if (!v) return { ok: false, response: json(401, "token_invalido", "Token inválido, vencido o revocado") };
    actor = { userId: v.userId, via: opciones.via ?? "api", tokenId: v.tokenId, ip, alcances: v.scopes };
  } else {
    actor = await actorDeSesion(req.headers);
    if (!actor) return { ok: false, response: noEncontrado() };
  }

  if (opciones.scope && !actor.alcances.has(opciones.scope)) {
    return { ok: false, response: json(403, "alcance_insuficiente", `Requiere el alcance ${opciones.scope}`) };
  }
  return { ok: true, actor };
}

/** Para páginas y layouts de `/platform`: 404 si no es Super-Admin. */
export async function requirePlataformaPagina(): Promise<ActorPlataforma> {
  if (!esPlataforma()) notFound();
  const actor = await actorDeSesion(await headers());
  if (!actor) notFound();
  return actor;
}
