import { citasParaElCerebro, requireBrainAgenda } from "@/server/brains/agenda";

export const dynamic = "force-dynamic";

/** 070 — `GET /api/brains/agenda/bookings?conversationId=…` (forma v2, sin anunciar). */
export async function GET(req: Request) {
  const g = await requireBrainAgenda(req);
  if (!g.ok) return g.response;
  return citasParaElCerebro(req, g.ambito.organizationId);
}
