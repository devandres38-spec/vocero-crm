import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { apiError } from "@/lib/api";
import { requireBot } from "@/server/bot/auth";
import { rutaDelCerebro } from "@/server/bot/ruta";
import { serializeBotProfile, type BotLlm } from "@/server/bot/profile";
import { resolveAiProvider } from "@/lib/ai/provider";

export const dynamic = "force-dynamic";

/**
 * Perfil del agente + knowledge base para un cerebro externo.
 * GET /api/bot/profile → {profile, kb, resources}. Sin caché: cada consulta
 * refleja lo que el dueño dejó en la UI al momento (el TTL vive del lado del
 * bot, que es quien sabe cada cuánto le conviene releer).
 */
async function getSinNegocio(req: Request) {
  const auth = await requireBot(req);
  if (auth instanceof Response) return auth;

  const { organizationId } = auth;

  const db = getDb();
  const profiles = await db
    .select()
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const profile = profiles[0];
  if (!profile) {
    // Condición esperada (instancia sin perfil): el bot cae a su brief local.
    return apiError(404, "no_profile", "La instancia no tiene perfil de agente");
  }

  const kb = await db
    .select()
    .from(schema.kbEntry)
    .where(eq(schema.kbEntry.organizationId, organizationId))
    .orderBy(asc(schema.kbEntry.createdAt));

  // 036 — Con qué piensa el cerebro que no trae llave: el proxy del CRM.
  const ia = await resolveAiProvider(organizationId);
  const llm: BotLlm = ia.ok && ia.provider.model ? { path: "/api/bot/llm", model: ia.provider.model } : null;

  return Response.json(serializeBotProfile(profile, kb, llm));
}

// 075 — Autentica el negocio y corre la ruta dentro de él (RLS).
export const GET = rutaDelCerebro(getSinNegocio);
