import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { clientIp } from "@/lib/rate-limit";
import { esPlataforma } from "@/lib/tenancy";
import type { Actor } from "@/server/platform/invitaciones";
import { esSuperAdmin } from "@/server/tenant/consultas";

/**
 * 069 (FR-006) — La única puerta de `/platform` y `/api/platform/*`: modo
 * plataforma + Super-Admin. Para cualquier otro, 404 (no 403): la superficie
 * no se anuncia. Los tokens personales `alp_…` se suman aquí (US8).
 */

export type ActorPlataforma = Actor & { alcances: ReadonlySet<"read" | "provision"> };

const TODOS: ReadonlySet<"read" | "provision"> = new Set(["read", "provision"]);

async function actorDeSesion(h: Headers): Promise<ActorPlataforma | null> {
  if (!esPlataforma()) return null;
  const s = await getAuth().api.getSession({ headers: h });
  if (!s || !(await esSuperAdmin(s.user.id))) return null;
  return { userId: s.user.id, via: "sesion", ip: clientIp(h), alcances: TODOS };
}

export function noEncontrado(): Response {
  return new Response(null, { status: 404 });
}

/** Para route handlers. */
export async function requirePlataforma(
  req: Request,
  opciones: { scope?: "read" | "provision" } = {}
): Promise<{ ok: true; actor: ActorPlataforma } | { ok: false; response: Response }> {
  const actor = await actorDeSesion(req.headers);
  if (!actor) return { ok: false, response: noEncontrado() };
  if (opciones.scope && !actor.alcances.has(opciones.scope)) {
    return {
      ok: false,
      response: Response.json(
        { error: { code: "alcance_insuficiente", message: `Requiere el alcance ${opciones.scope}` } },
        { status: 403 }
      ),
    };
  }
  return { ok: true, actor };
}

/** Para páginas y layouts de `/platform`: 404 si no es Super-Admin. */
export async function requirePlataformaPagina(): Promise<ActorPlataforma> {
  const actor = await actorDeSesion(await headers());
  if (!actor) notFound();
  return actor;
}
