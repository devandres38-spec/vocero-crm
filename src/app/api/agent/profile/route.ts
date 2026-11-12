import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  CLAVES_HERRAMIENTA,
  herramientasEfectivas,
  rolDe,
  type ClaveHerramienta,
} from "@/lib/agent-roles";
import { agendaEnabled } from "@/server/agenda/flag";
import { leerConfigDespacho, urlSaludCerebro } from "@/server/brains/config";
import { getBrainHealth } from "@/server/bot/status";
import { validarListaDeNumeros } from "@/server/dispatch/solo-numeros";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, session.organizationId))
    .limit(1);
  const p = rows[0];
  if (!p) return apiError(404, "not_found", "Perfil del agente no encontrado");
  return Response.json({
    profile: {
      enabled: p.enabled,
      name: p.name,
      tone: p.tone,
      instructions: p.instructions,
      escalationRules: p.escalationRules,
      greeting: p.greeting,
      // 034
      role: rolDe(p.role).clave,
      tools: herramientasEfectivas(p.tools),
      // 079 — «Solo estos números» (piloto).
      soloNumeros: { activo: p.soloNumerosActivo, numeros: p.soloNumeros },
    },
    // 034 — Sin la bandera, la pantalla no ofrece agendar ni reprogramar.
    agendaEnabled: agendaEnabled(),
    // 080 (D3) — Sin `aiConfigured`: el cerebro piensa con su propia llave, y
    // la de Vocero (la de Aliantis) solo la usa el juez del Laboratorio.
  });
});

const putSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().trim().min(1).max(60).optional(),
  tone: z.string().max(500).nullable().optional(),
  instructions: z.string().max(8000).nullable().optional(),
  escalationRules: z.string().max(4000).nullable().optional(),
  greeting: z.string().max(1000).nullable().optional(),
  // 034 — Solo claves del catálogo; `escalar` se guarda siempre.
  tools: z
    .array(z.enum(CLAVES_HERRAMIENTA as [ClaveHerramienta, ...ClaveHerramienta[]]))
    .max(CLAVES_HERRAMIENTA.length)
    .optional(),
  // 079 — «Solo estos números» (piloto): la ruta limpia y valida cada número.
  soloNumeros: z
    .object({
      activo: z.boolean(),
      numeros: z.array(z.string().max(40)).max(50),
    })
    .optional(),
});

export const PUT = withAuth(async (session, req: Request) => {
  // 079 — Encender el Agente, escribirlo o cambiar la lista es configurar,
  // como cargar un rol (`preset`): un miembro del equipo atiende la Bandeja.
  if (!canConfigure(session.role)) {
    return apiError(403, "forbidden", "Solo quien administra puede cambiar el agente");
  }
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;

  let lista: { activo: boolean; numeros: string[] } | null = null;
  if (body.data.soloNumeros) {
    const v = validarListaDeNumeros(body.data.soloNumeros);
    if (!v.ok) return apiError(422, v.code, v.message);
    lista = v.lista;
  }

  // 036 — El interruptor decide si el CRM le despacha al cerebro. Encenderlo
  // sin un cerebro que conteste dejaría a los clientes sin respuesta creyendo
  // que la tienen; apagarlo siempre se puede.
  if (body.data.enabled === true) {
    const problema = await problemaDelCerebro();
    if (problema) return apiError(409, "sin_cerebro", problema);
  }

  const db = getDb();
  const { tools, soloNumeros: _lista, ...resto } = body.data;
  const updated = await db
    .update(schema.agentProfile)
    .set({
      ...resto,
      ...(tools ? { tools: herramientasEfectivas(tools) } : {}),
      ...(lista ? { soloNumerosActivo: lista.activo, soloNumeros: lista.numeros } : {}),
      updatedAt: new Date(),
    })
    .where(scoped(schema.agentProfile.organizationId, session.organizationId))
    .returning();
  if (!updated[0]) return apiError(404, "not_found", "Perfil no encontrado");
  return Response.json({ ok: true });
});

/** Por qué no se puede encender el agente, o `null` si hay cerebro sano. */
async function problemaDelCerebro(): Promise<string | null> {
  const despacho = leerConfigDespacho();
  if (!despacho.active) {
    return despacho.problem === "sin_llave"
      ? "Falta BOT_API_KEY: sin ella el CRM no puede despacharle a tu agente."
      : despacho.problem === "url"
        ? "BRAIN_DISPATCH_URL no es una dirección válida."
        : "No hay un agente conectado. Conéctalo (BRAIN_DISPATCH_URL) y vuelve a encenderlo.";
  }
  const salud = await getBrainHealth(urlSaludCerebro() ?? undefined);
  if (salud && !salud.reachable) {
    return `Tu agente (${despacho.host}) no contesta. Revisa que esté corriendo y vuelve a intentar.`;
  }
  return null;
}
