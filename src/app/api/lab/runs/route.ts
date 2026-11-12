import { desc } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isAiConfiguredFor } from "@/lib/ai/provider";
import { canConfigure } from "@/lib/auth/roles";
import { leerConfigDespacho } from "@/server/brains/config";
import { RunConflictError, startRun, TopeAlcanzadoError } from "@/server/lab/runner";
import { diaDe, estadoTopeDe, mensajeTope, topeDiarioDe } from "@/server/lab/tope";

export const dynamic = "force-dynamic";

/** Historial de corridas con delta de score vs la anterior (FR-033). */
export const GET = withAuth(async (session) => {
  const db = getDb();
  const runs = await db
    .select()
    .from(schema.agentTestRun)
    .where(scoped(schema.agentTestRun.organizationId, session.organizationId))
    .orderBy(desc(schema.agentTestRun.startedAt))
    .limit(50);

  const withDelta = runs.map((run, i) => {
    const prev = runs
      .slice(i + 1)
      .find((r) => r.status === "done" && r.score !== null);
    return {
      id: run.id,
      status: run.status,
      score: run.score,
      error: run.error,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      delta:
        run.status === "done" && run.score !== null && prev?.score != null
          ? run.score - prev.score
          : null,
    };
  });
  const tope = await estadoTopeDe(session.organizationId);
  return Response.json({
    runs: withDelta,
    aiConfigured: await isAiConfiguredFor(),
    // 036 — Sin cerebro conectado, la pantalla lo dice en vez de ofrecer correr.
    brainConnected: leerConfigDespacho().active,
    // 080 (D20) — Cuántas corridas lleva hoy (en la zona del negocio) y su tope.
    laboratorio: {
      corridasHoy: tope.corridasHoy,
      topeDiario: tope.topeDiario,
      disponible: tope.disponible,
      seLibera: tope.seLibera.toISOString(),
    },
    // 080 (P3) — Correrlo gasta dinero de Aliantis: solo quien administra.
    puedeCorrer: canConfigure(session.role),
  });
});

/**
 * 080 — En este orden: quién (P3), a quién probar, con qué juzgar, el tope del
 * día (D20) y la corrida en curso.
 */
export const POST = withAuth(async (session) => {
  if (!canConfigure(session.role)) {
    return apiError(403, "forbidden", "Solo quien administra puede correr el Laboratorio");
  }
  // 036 — El Laboratorio prueba al cerebro conectado: sin él no hay a quién.
  if (!leerConfigDespacho().active) {
    return apiError(
      409,
      "sin_cerebro",
      "Conecta tu agente para correr el Laboratorio: prueba al cerebro que contesta a tus clientes"
    );
  }
  // 080 (D20) — El juez paga con la llave de Aliantis; sin ella, no hay Laboratorio.
  if (!(await isAiConfiguredFor())) {
    return apiError(
      409,
      "laboratorio_sin_llave",
      "El Laboratorio no está disponible ahora. Avísale a Aliantis."
    );
  }
  const [dia, maximo] = await Promise.all([
    diaDe(session.organizationId),
    topeDiarioDe(session.organizationId),
  ]);
  try {
    // SABOTAJE 2: POST /api/lab/runs sin el tope, la corrida N+1 se crea.
    const runId = await startRun(session.organizationId, { maximo: 999999, desde: dia.desde });
    return Response.json({ runId }, { status: 202 });
  } catch (err) {
    if (err instanceof TopeAlcanzadoError) {
      return apiError(429, "tope_laboratorio", mensajeTope(maximo, dia.seLibera, dia.zona));
    }
    if (err instanceof RunConflictError) {
      return apiError(
        409,
        "run_in_progress",
        "Ya hay una corrida en curso; espera a que termine"
      );
    }
    throw err;
  }
});
