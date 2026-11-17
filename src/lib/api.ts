import { z } from "zod";
import {
  OrganizacionSuspendidaError,
  requireSession,
  SinAccesoError,
  UnauthorizedError,
  type SessionContext,
} from "@/lib/auth/session";
import { clientIp } from "@/lib/rate-limit";
import { auditar } from "@/server/platform/auditoria";

/** Respuesta de error estándar de la API interna (contrato api.md). */
export function apiError(
  status: number,
  code: string,
  message: string
): Response {
  return Response.json({ error: { code, message } }, { status });
}

export type OpcionesWithAuth = {
  /**
   * 069 (D5) — Esta ruta admite mutaciones bajo un acceso de soporte de nivel
   * `configuracion`. Por defecto ninguna: un Super-Admin con acceso solo LEE.
   * La lista exacta de rutas que lo declaran la vigila
   * `tests/unit/soporte-rutas-configuracion.test.ts`.
   */
  soporte?: "configuracion";
};

/**
 * Envuelve un route handler autenticado: resuelve la sesión (401 si no hay),
 * captura errores no controlados (500 sin stack) y deja pasar Response.
 *
 * 069 — Bajo acceso de soporte: GET/HEAD siempre; una mutación solo con nivel
 * `configuracion` en una ruta que lo declara (si no, 403 `solo_lectura` o
 * `fuera_de_alcance`). Cada petición de soporte queda auditada; una mutación,
 * con los nombres de los campos que traía (nunca sus valores).
 */
export function withAuth<Args extends unknown[]>(
  handler: (session: SessionContext, ...args: Args) => Promise<Response>,
  opciones: OpcionesWithAuth = {}
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    let session: SessionContext;
    try {
      session = await requireSession();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        return apiError(401, "unauthorized", "No autenticado");
      }
      // 069 — Suspendida: la organización existe y es suya, pero no opera.
      if (err instanceof OrganizacionSuspendidaError) {
        return apiError(403, "organizacion_suspendida", "Esta organización está suspendida");
      }
      if (err instanceof SinAccesoError) return new Response(null, { status: 404 });
      throw err;
    }
    if (session.via === "soporte") {
      const bloqueo = await controlarSoporte(session, args[0], opciones);
      if (bloqueo) return bloqueo;
    }
    try {
      return await handler(session, ...args);
    } catch (err) {
      console.error("[api] error no controlado:", err);
      return apiError(500, "internal", "Error interno");
    }
  };
}

const LECTURA = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * 069 (US5) — Ni leer: credenciales y conexiones (IA, WhatsApp, canales,
 * conectores, Meta CAPI, webhook) y el equipo. Un acceso de soporte, sea del
 * nivel que sea, no las ve ni las toca.
 */
export const RUTAS_VETADAS_SOPORTE = [
  "/api/settings/ai",
  "/api/settings/whatsapp",
  "/api/settings/team",
  "/api/settings/channels",
  "/api/settings/instagram",
  "/api/settings/messenger",
  "/api/settings/tiktok",
  "/api/settings/google",
  "/api/settings/zoom",
  "/api/settings/capi",
  "/api/settings/webhook",
] as const;

function vetadaParaSoporte(ruta: string | null): boolean {
  return !!ruta && RUTAS_VETADAS_SOPORTE.some((p) => ruta === p || ruta.startsWith(`${p}/`));
}

/** `null` = puede seguir (ya auditado); si no, la respuesta 403. */
export async function controlarSoporte(
  session: SessionContext,
  primerArg: unknown,
  opciones: OpcionesWithAuth
): Promise<Response | null> {
  const req = primerArg instanceof Request ? primerArg : null;
  const metodo = (req?.method ?? "GET").toUpperCase();
  const ruta = req ? new URL(req.url).pathname : null;
  const nivel = session.grant?.level ?? "lectura";
  const esLectura = LECTURA.has(metodo);
  const vetada = vetadaParaSoporte(ruta);
  const permitido =
    !vetada && (esLectura || (nivel === "configuracion" && opciones.soporte === "configuracion"));

  const changedKeys = !esLectura && permitido && req ? await clavesDelCuerpo(req) : undefined;
  await auditar({
    actorUserId: session.userId,
    action: permitido ? "soporte_peticion" : "acceso_denegado",
    organizationId: session.organizationId,
    ip: req ? clientIp(req.headers) : null,
    detail: {
      grantId: session.grant?.id ?? null,
      level: nivel,
      method: metodo,
      path: ruta,
      ...(changedKeys ? { changedKeys } : {}),
      ...(permitido ? {} : { motivo: vetada || nivel === "configuracion" ? "fuera_de_alcance" : "solo_lectura" }),
    },
  }).catch((err) => console.error("[soporte] no se pudo auditar:", err));

  if (permitido) return null;
  return nivel === "lectura" && !vetada
    ? apiError(403, "solo_lectura", "El acceso de soporte es de solo lectura")
    : apiError(403, "fuera_de_alcance", "El acceso de soporte no permite cambiar esto");
}

/** Los nombres de los campos del cuerpo JSON, sin consumir el original. */
async function clavesDelCuerpo(req: Request): Promise<string[]> {
  try {
    const body = (await req.clone().json()) as unknown;
    return body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body).sort() : [];
  } catch {
    return [];
  }
}

/** Parsea el body JSON con un esquema Zod; inválido → Response 422. */
export async function parseBody<T>(
  req: Request,
  schema: z.ZodType<T>
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      ok: false,
      response: apiError(422, "invalid_body", "El body debe ser JSON válido"),
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
      .join("; ");
    return {
      ok: false,
      response: apiError(422, "invalid_body", detail),
    };
  }
  return { ok: true, data: parsed.data };
}
