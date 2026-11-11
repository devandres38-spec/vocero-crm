import { apiError } from "@/lib/api";
import { requireBot } from "@/server/bot/auth";
import { rutaDelCerebro } from "@/server/bot/ruta";
import { historialDe, historialSchema } from "@/server/bot/historial";

export const dynamic = "force-dynamic";

/**
 * 071 (067 §5) — `GET /api/bot/history?conversationId=…&limit=…`: los últimos
 * mensajes de una conversación, del más viejo al más nuevo, ya filtrados.
 *
 * 200 `{ conversationId, messages }` · 404 `not_found` · 422 `invalid_body`.
 */
async function getSinNegocio(req: Request) {
  const auth = await requireBot(req);
  if (auth instanceof Response) return auth;

  const { organizationId } = auth;

  const url = new URL(req.url);
  const query = historialSchema.safeParse({
    conversationId: url.searchParams.get("conversationId") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!query.success) {
    return apiError(
      422,
      "invalid_body",
      "conversationId es obligatorio y limit va de 1 a 50",
    );
  }

  const messages = await historialDe(
    organizationId,
    query.data.conversationId,
    query.data.limit,
  );
  if (!messages)
    return apiError(404, "not_found", "Conversación no encontrada");
  return Response.json({ conversationId: query.data.conversationId, messages });
}

// 075 — Autentica el negocio y corre la ruta dentro de él (RLS).
export const GET = rutaDelCerebro(getSinNegocio);
