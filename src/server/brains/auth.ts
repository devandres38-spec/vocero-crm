import { timingSafeEqual } from "node:crypto";
import { eq, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { apiError } from "@/lib/api";
import { esPlataforma } from "@/lib/tenancy";
import {
  BRAIN_FALLO_IP_RATE_LIMIT,
  BRAIN_FALLO_ORG_RATE_LIMIT,
  checkRateLimit,
  clientIp,
  llaveFalloCerebro,
  llaveFalloCerebroIp,
  rateLimitExcedido,
} from "@/lib/rate-limit";
import { credencialDerivada, secretoDeDespliegue } from "@/server/brains/deployment";

/**
 * 070 (D4, contrato §1) — La ÚNICA puerta de `/api/brains/*`.
 *
 * Un cerebro se presenta con `Authorization: Bearer <credencial>` y
 * `X-Vocero-Organization: <slug | id>`. La credencial es la derivada del
 * secreto del despliegue ASIGNADO a esa organización; el ámbito que sale de
 * aquí (`organizationId`) es el único del que la ruta puede leer o escribir.
 *
 * - En `single` la superficie no existe: 404 vacío (simetría con `/api/bot/*`
 *   en `multi`).
 * - Todo fallo de credencial es el MISMO 401: no se distingue «no existe esa
 *   organización» de «credencial equivocada» (sin oráculo de slugs).
 * - Cada rechazo cuenta por (IP, organización) y, más holgado, por IP, en
 *   llaves propias (no las de los tokens `alp_`); pasado el tope, 429 antes
 *   de tocar la base (auditoría 070, A-1 y C-1).
 * - Suspendida → 403 DESPUÉS de autenticar (solo quien tiene la credencial
 *   se entera).
 */

export const CABECERA_ORGANIZACION = "x-vocero-organization";

/** Presupuesto por organización (mismo orden que `/api/bot`). */
export const BRAINS_API_BUDGET = { windowMs: 60_000, max: 1200 };

export type AmbitoCerebro = {
  organizationId: string;
  slug: string | null;
  deploymentId: string;
};

export type ResultadoCerebro =
  | { ok: true; ambito: AmbitoCerebro }
  | { ok: false; response: Response };

const MAX_CABECERA = 128;

function bearer(req: Request): string | null {
  const auth = req.headers.get("authorization");
  const m = auth ? /^Bearer\s+(\S+)$/i.exec(auth.trim()) : null;
  const v = m?.[1];
  return v && v.length <= 128 ? v : null;
}

/** Pura: comparación en tiempo constante (longitudes distintas = falso). */
export function credencialCoincide(recibida: string, esperada: string): boolean {
  const a = Buffer.from(recibida);
  const b = Buffer.from(esperada);
  return a.length === b.length && timingSafeEqual(a, b);
}

function noAutorizado(): Response {
  return apiError(401, "unauthorized", "No autorizado");
}

export async function requireBrain(req: Request): Promise<ResultadoCerebro> {
  if (!esPlataforma()) return { ok: false, response: new Response(null, { status: 404 }) };

  // Auditoría 070 (A-1, C-1): los fallos se cuentan por (IP, organización)
  // —todos los negocios de una Nea `multiorg` salen por la MISMA IP, y uno
  // reasignado no puede tumbar a los demás— más un tope holgado por IP. Y en
  // llaves propias: no se mezclan con las de los tokens `alp_`.
  const ip = clientIp(req.headers);
  const cabecera = req.headers.get(CABECERA_ORGANIZACION)?.trim() ?? "";
  const llaveOrg = llaveFalloCerebro(ip, cabecera || "-");
  const llaveIp = llaveFalloCerebroIp(ip);
  if (
    rateLimitExcedido(llaveOrg, BRAIN_FALLO_ORG_RATE_LIMIT) ||
    rateLimitExcedido(llaveIp, BRAIN_FALLO_IP_RATE_LIMIT)
  ) {
    return { ok: false, response: apiError(429, "rate_limited", "Demasiados intentos fallidos") };
  }
  const rechazar = (): ResultadoCerebro => {
    checkRateLimit(llaveOrg, BRAIN_FALLO_ORG_RATE_LIMIT);
    checkRateLimit(llaveIp, BRAIN_FALLO_IP_RATE_LIMIT);
    return { ok: false, response: noAutorizado() };
  };

  const credencial = bearer(req);
  if (!credencial || !cabecera || cabecera.length > MAX_CABECERA) return rechazar();

  const filas = await getDb()
    .select({
      id: schema.organization.id,
      slug: schema.organization.slug,
      status: schema.organization.status,
      deploymentId: schema.organization.brainDeploymentId,
      // M-1: el estado y la versión del despliegue salen de la base en CADA
      // petición; el secreto en caché solo vale si su versión coincide.
      despliegueEstado: schema.brainDeployment.status,
      despliegueVersion: schema.brainDeployment.updatedAt,
    })
    .from(schema.organization)
    .leftJoin(schema.brainDeployment, eq(schema.brainDeployment.id, schema.organization.brainDeploymentId))
    .where(or(eq(schema.organization.slug, cabecera), eq(schema.organization.id, cabecera)))
    .limit(2);
  // Un slug idéntico al id de OTRA organización sería ambiguo: se rechaza.
  if (filas.length !== 1) return rechazar();
  const org = filas[0]!;
  if (!org.deploymentId) return rechazar();
  if (org.despliegueEstado != null && org.despliegueEstado !== "activo") return rechazar();

  const despliegue = await secretoDeDespliegue(org.deploymentId, {
    version: org.despliegueVersion ?? undefined,
  });
  if (!despliegue || despliegue.status !== "activo") return rechazar();
  if (!credencialCoincide(credencial, credencialDerivada(despliegue.secreto, org.id))) {
    return rechazar();
  }

  if (org.status === "suspendida") {
    return {
      ok: false,
      response: apiError(403, "organizacion_suspendida", "Este negocio está suspendido"),
    };
  }

  const presupuesto = checkRateLimit(`brains-api:${org.id}`, BRAINS_API_BUDGET);
  if (!presupuesto.allowed) {
    return { ok: false, response: apiError(429, "rate_limited", "Demasiadas solicitudes") };
  }

  return {
    ok: true,
    ambito: { organizationId: org.id, slug: org.slug ?? null, deploymentId: org.deploymentId },
  };
}
