import { apiError } from "@/lib/api";
import { contextoDelCerebro } from "@/server/brains/context";
import { withBrain } from "@/server/brains/http";

export const dynamic = "force-dynamic";

/**
 * 070 — `GET /api/brains/context?conversationId=…&contextVersion=2`.
 *
 * Solo por conversación: el ámbito de un cerebro es la organización de su
 * credencial, y buscar por teléfono le dejaría preguntar por gente que no le
 * corresponde. Cuerpo = el de `/api/bot/context` + `agent`, `knowledge` y
 * `llm` (ver `src/server/brains/context.ts`). Auth y errores: `withBrain`.
 */
export const GET = withBrain(async (req, ambito) => {
  const conversationId = new URL(req.url).searchParams.get("conversationId");
  if (!conversationId || conversationId.length > 128) {
    return apiError(422, "invalid", "Falta conversationId");
  }
  const cuerpo = await contextoDelCerebro(ambito.organizationId, conversationId);
  if (!cuerpo) return apiError(404, "not_found", "Conversación no encontrada");
  return Response.json(cuerpo);
});
