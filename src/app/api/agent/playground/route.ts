import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { getDb, schema } from "@/lib/db";
import { esPlataforma } from "@/lib/tenancy";
import { ajustesDelNegocio } from "@/server/ajustes-bot";
import { destinoDe } from "@/server/brains/destino";
import {
  diaDelEnsayo,
  ensayar,
  MAX_HISTORIAL_ENSAYO,
  MAX_TEXTO_ENSAYO,
  urlDeEnsayo,
  usadosHoy,
} from "@/server/playground";

export const dynamic = "force-dynamic";
// Un ensayo corre el turno entero (modelo + herramientas): hasta ~2 min.
export const maxDuration = 150;

/**
 * 074 (D9, decisión #9) — «Probar mi agente» (`src/server/playground.ts`).
 *
 * Solo el dueño o un admin del negocio (un `member` atiende la Bandeja; un
 * acceso de soporte no gasta la llave del negocio). Solo en modo plataforma.
 * El negocio sale de la sesión, nunca del cuerpo: no hay forma de ensayar
 * con el agente (ni la llave) de otro.
 */

function soloConfigura(role: string): Response | null {
  return canConfigure(role) ? null : apiError(403, "forbidden", "Solo el dueño o un admin pueden probar el agente");
}

export const GET = withAuth(async (session) => {
  const prohibido = soloConfigura(session.role);
  if (prohibido) return prohibido;
  const ajustes = await ajustesDelNegocio(session.organizationId);
  const usados = await usadosHoy(session.organizationId, diaDelEnsayo(new Date(), ajustes.timezone));
  const destino = esPlataforma() ? await destinoDe(session.organizationId) : null;
  return Response.json({
    available: esPlataforma() && Boolean(destino && urlDeEnsayo(destino.url)),
    platform: esPlataforma(),
    used: usados,
    limit: ajustes.bot.playgroundPerDay,
    remaining: Math.max(0, ajustes.bot.playgroundPerDay - usados),
  });
});

const texto = z.string().trim().min(1).max(MAX_TEXTO_ENSAYO);
const postSchema = z
  .object({
    message: texto,
    history: z
      .array(z.object({ role: z.enum(["customer", "agent"]), text: texto }).strict())
      .max(MAX_HISTORIAL_ENSAYO)
      .default([]),
  })
  .strict();

export const POST = withAuth(async (session, req: Request) => {
  const prohibido = soloConfigura(session.role);
  if (prohibido) return prohibido;
  const body = await parseBody(req, postSchema);
  if (!body.ok) return body.response;
  const [org] = await getDb()
    .select({ slug: schema.organization.slug })
    .from(schema.organization)
    .where(eq(schema.organization.id, session.organizationId))
    .limit(1);
  const r = await ensayar({
    organizationId: session.organizationId,
    slug: org?.slug ?? null,
    message: body.data.message,
    history: body.data.history,
  });
  if (!r.ok) {
    return Response.json(
      { error: { code: r.code, message: r.message }, ...(r.tope ? { used: r.usados, limit: r.tope, remaining: 0 } : {}) },
      { status: r.status }
    );
  }
  return Response.json({
    turn: r.turn,
    notice: r.aviso,
    used: r.usados,
    limit: r.tope,
    remaining: Math.max(0, r.tope - r.usados),
    simulated: true,
  });
});
