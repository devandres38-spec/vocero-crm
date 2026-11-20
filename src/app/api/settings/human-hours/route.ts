import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { getDb, schema } from "@/lib/db";
import { horarioHumanoSchema, leerHorarioHumano } from "@/lib/horario-humano";
import { ajustesDeMetadata } from "@/server/ajustes-bot";
import { camposDeHorario } from "@/server/brains/humano";

export const dynamic = "force-dynamic";

/**
 * 073-B (D6, decisión #7) — El horario en que hay personas para atender el
 * chat (uno por negocio). Lo lee el cerebro como `humanAvailable` /
 * `nextOpenAt` para no prometer un asesor a medianoche. `null` = sin
 * horario (el agente no dice nada de horarios humanos, como antes).
 */
async function leerMeta(organizationId: string): Promise<{ raw: string | null; meta: Record<string, unknown> }> {
  const [fila] = await getDb()
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  const raw = fila?.metadata ?? null;
  let meta: Record<string, unknown> = {};
  try {
    const m = raw ? (JSON.parse(raw) as unknown) : null;
    if (m && typeof m === "object" && !Array.isArray(m)) meta = m as Record<string, unknown>;
  } catch {
    meta = {};
  }
  return { raw, meta };
}

export const GET = withAuth(async (session) => {
  const { raw } = await leerMeta(session.organizationId);
  const ajustes = ajustesDeMetadata(raw);
  return Response.json({
    humanHours: ajustes.horario,
    timezone: ajustes.timezone,
    ahora: camposDeHorario(ajustes),
  });
});

const putSchema = z.object({ humanHours: horarioHumanoSchema.nullable() }).strict();

export const PUT = withAuth(async (session, req: Request) => {
  if (!canConfigure(session.role)) {
    return apiError(403, "forbidden", "Solo quien administra el negocio puede cambiar el horario");
  }
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  // Solo SU organización: la fila sale del id de la sesión (A↛B).
  const { meta } = await leerMeta(session.organizationId);
  const horario = body.data.humanHours === null ? null : leerHorarioHumano(body.data.humanHours);
  if (horario === null) delete meta.humanHours;
  else meta.humanHours = horario;
  const metadata = JSON.stringify(meta);
  await getDb()
    .update(schema.organization)
    .set({ metadata })
    .where(eq(schema.organization.id, session.organizationId));
  const ajustes = ajustesDeMetadata(metadata);
  return Response.json({ humanHours: horario, timezone: ajustes.timezone, ahora: camposDeHorario(ajustes) });
});
