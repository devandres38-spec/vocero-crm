import { parseBody } from "@/lib/api";
import { requireBrain } from "@/server/brains/auth";
import { cuerpoMensajeCerebro, responderPorElCerebro } from "@/server/brains/respuestas";

export const dynamic = "force-dynamic";

/**
 * 070 — `POST /api/brains/messages {dispatchId, conversationId, text}`.
 * 201 al crear (el cliente acepta cualquier 2xx); el reintento del mismo
 * texto en el mismo despacho, 200 con el mismo `messageId`. Ver
 * `src/server/brains/respuestas.ts`.
 */
export async function POST(req: Request) {
  const g = await requireBrain(req);
  if (!g.ok) return g.response;
  const body = await parseBody(req, cuerpoMensajeCerebro);
  if (!body.ok) return body.response;
  return responderPorElCerebro(g.ambito, body.data);
}
