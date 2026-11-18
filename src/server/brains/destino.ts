import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { esPlataforma } from "@/lib/tenancy";
import { leerConfigDespacho, urlSaludCerebro, type ConfigDespacho } from "@/server/brains/config";
import { secretoDeDespliegue, urlDeSalud } from "@/server/brains/deployment";

/**
 * 070 (D10, D11) — A qué cerebro se le despacha un negocio.
 *
 * - `single`: el de siempre, por entorno (`BRAIN_DISPATCH_URL` + `BOT_API_KEY`).
 * - `multi`: el despliegue ASIGNADO a esa organización, si el negocio está
 *   activo y el despliegue también. El secreto es el del despliegue (firma el
 *   despacho; Nea deriva con él la credencial con que contesta).
 *
 * Se resuelve al ENTREGAR, no al encolar: si entre medias se reasigna o se
 * pausa, el turno va a donde corresponde ahora (o no va).
 */

export type DestinoCerebro = {
  url: string;
  secret: string;
  /** `single`: el host de la URL. `multi`: el NOMBRE del despliegue (el dueño no ve URLs). */
  host: string;
  deploymentId: string | null;
  healthUrl: string | null;
};

type Asignacion = {
  orgStatus: "activa" | "suspendida";
  deploymentId: string | null;
  name: string | null;
  status: "activo" | "pausado" | null;
  dispatchUrl: string | null;
  healthUrl: string | null;
};

async function asignacionDe(organizationId: string): Promise<Asignacion | null> {
  const [f] = await getDb()
    .select({
      orgStatus: schema.organization.status,
      deploymentId: schema.brainDeployment.id,
      name: schema.brainDeployment.name,
      status: schema.brainDeployment.status,
      dispatchUrl: schema.brainDeployment.dispatchUrl,
      healthUrl: schema.brainDeployment.healthUrl,
    })
    .from(schema.organization)
    .leftJoin(schema.brainDeployment, eq(schema.brainDeployment.id, schema.organization.brainDeploymentId))
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return f ?? null;
}

export async function destinoDe(organizationId: string): Promise<DestinoCerebro | null> {
  if (!esPlataforma()) {
    const c = leerConfigDespacho();
    return c.active
      ? { url: c.url, secret: c.secret, host: c.host, deploymentId: null, healthUrl: urlSaludCerebro() }
      : null;
  }
  const a = await asignacionDe(organizationId);
  if (!a || a.orgStatus !== "activa" || !a.deploymentId || a.status !== "activo" || !a.dispatchUrl) {
    return null;
  }
  const s = await secretoDeDespliegue(a.deploymentId);
  if (!s || s.status !== "activo") return null;
  return {
    url: a.dispatchUrl,
    secret: s.secreto,
    host: a.name ?? "",
    deploymentId: a.deploymentId,
    healthUrl: urlDeSalud({ dispatchUrl: a.dispatchUrl, healthUrl: a.healthUrl }),
  };
}

/** ¿Se le despacha a un cerebro ESTE negocio? (la ingesta lo pregunta por mensaje) */
export async function despachoActivoPara(organizationId: string): Promise<boolean> {
  return (await destinoDe(organizationId)) !== null;
}

/**
 * La configuración del despacho como la lee la tarjeta «Quién responde».
 * En `multi`, `host` es el nombre del despliegue (nunca su URL) y un
 * despliegue pausado cuenta como «hay cerebro, pero no despacha».
 */
export async function configDespachoPara(organizationId: string): Promise<ConfigDespacho> {
  if (!esPlataforma()) return leerConfigDespacho();
  const d = await destinoDe(organizationId);
  if (d) return { active: true, url: d.url, host: d.host, secret: d.secret };
  const a = await asignacionDe(organizationId);
  return { active: false, host: a?.name ?? null, problem: null };
}

/** Por qué no se puede encender el agente (en `multi`), o `null`. */
export type ProblemaPlataforma = "sin_asignar" | "pausado" | "suspendida" | "caido";

export async function problemaDeCerebroEnPlataforma(
  organizationId: string,
  salud: (url: string) => Promise<{ reachable: boolean } | null>
): Promise<{ problema: ProblemaPlataforma; nombre: string | null } | null> {
  const a = await asignacionDe(organizationId);
  if (!a || !a.deploymentId) return { problema: "sin_asignar", nombre: null };
  if (a.orgStatus !== "activa") return { problema: "suspendida", nombre: a.name };
  if (a.status !== "activo" || !a.dispatchUrl) return { problema: "pausado", nombre: a.name };
  const r = await salud(urlDeSalud({ dispatchUrl: a.dispatchUrl, healthUrl: a.healthUrl }));
  if (!r || !r.reachable) return { problema: "caido", nombre: a.name };
  return null;
}

/** El texto para el dueño (sin URLs ni secretos). */
export function mensajeProblemaPlataforma(p: { problema: ProblemaPlataforma; nombre: string | null }): string {
  switch (p.problema) {
    case "sin_asignar":
      return "Tu negocio aún no tiene un agente asignado. Pídeselo a la plataforma.";
    case "pausado":
      return `El agente asignado (${p.nombre ?? "sin nombre"}) está pausado por la plataforma.`;
    case "suspendida":
      return "El negocio está suspendido: no se puede encender el agente.";
    case "caido":
      return `El agente asignado (${p.nombre ?? "sin nombre"}) no contesta. Avísale a la plataforma y vuelve a intentar.`;
  }
}
