import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { esPlataforma } from "@/lib/tenancy";
import { urlSaludCerebro } from "@/server/brains/config";
import { configDespachoPara, destinoDe } from "@/server/brains/destino";
import { isAiConfiguredFor, resolveAiProviderDeOrganizacion } from "@/lib/ai/provider";
import { isBotKeyConfigured } from "@/server/bot/auth";
import {
  botLastSeenAt,
  computeBrainStatus,
  getBrainHealth,
} from "@/server/bot/status";
import { estadoDelDespacho } from "@/server/dispatch/estado";

export const dynamic = "force-dynamic";

/**
 * 036 — «Quién responde a tus clientes»: el cerebro conectado, su `/health`,
 * el despacho y el interruptor del Agente. Ver `src/server/bot/status.ts`.
 *
 * 070 — En modo plataforma, el cerebro es el despliegue asignado a ESTE
 * negocio: su salud, sus despachos y su NOMBRE (nunca su URL ni su secreto).
 * La IA cuenta solo si es la llave propia del negocio (D6).
 */
export const GET = withAuth(async (session) => {
  const db = getDb();
  const perfil = db
    .select({ enabled: schema.agentProfile.enabled })
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, session.organizationId))
    .limit(1);

  if (esPlataforma()) {
    const destino = await destinoDe(session.organizationId);
    const [rows, salud, ia, dispatch] = await Promise.all([
      perfil,
      destino?.healthUrl ? getBrainHealth(destino.healthUrl) : Promise.resolve(null),
      resolveAiProviderDeOrganizacion(session.organizationId),
      configDespachoPara(session.organizationId).then((c) =>
        estadoDelDespacho(session.organizationId, c)
      ),
    ]);
    const health = salud && destino ? { ...salud, host: destino.host } : salud;
    const status = computeBrainStatus({
      aiConfigured: ia.ok,
      agentEnabled: rows[0]?.enabled ?? false,
      botKeyConfigured: destino !== null,
      lastSeenAt: null,
      health,
      dispatch,
      now: new Date(),
    });
    return Response.json({ ...status, plataforma: true }, { headers: { "cache-control": "no-store" } });
  }

  const [rows, health, aiConfigured, dispatch] = await Promise.all([
    perfil,
    getBrainHealth(urlSaludCerebro() ?? undefined),
    isAiConfiguredFor(session.organizationId),
    estadoDelDespacho(session.organizationId),
  ]);
  const status = computeBrainStatus({
    aiConfigured,
    agentEnabled: rows[0]?.enabled ?? false,
    botKeyConfigured: isBotKeyConfigured(),
    lastSeenAt: botLastSeenAt(),
    health,
    dispatch,
    now: new Date(),
  });
  return Response.json(status, { headers: { "cache-control": "no-store" } });
});
