import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { requireBot } from "@/server/bot/auth";
import { omitirPorSalud } from "@/server/inbox/omitir";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  conversationId: z.string().min(1),
  messageIds: z.array(z.string().min(1)).min(1).max(20),
  reason: z.literal("salud"),
});

/**
 * 071 (067 §4b) — La segunda red de salud: omite el texto de entrantes que el
 * LLM del cerebro marcó con salud. Idempotente.
 *
 * 200 `{ omitted }` · 404 `not_found` · 422 `invalid_body`.
 */
export async function POST(req: Request) {
  const auth = await requireBot(req);
  if (auth instanceof Response) return auth;

  const { organizationId } = auth;

  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const r = await omitirPorSalud(
    organizationId,
    body.data.conversationId,
    body.data.messageIds,
  );
  if (!r.ok) return apiError(404, "not_found", "Conversación no encontrada");
  return Response.json({ omitted: r.omitted });
}
