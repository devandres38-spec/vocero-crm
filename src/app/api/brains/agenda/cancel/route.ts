import { cancelarPorElCerebro, requireBrainAgenda } from "@/server/brains/agenda";

export const dynamic = "force-dynamic";

/** 070 — `POST /api/brains/agenda/cancel` (forma v2, sin anunciar). Ver `src/server/brains/agenda.ts`. */
export async function POST(req: Request) {
  const g = await requireBrainAgenda(req);
  if (!g.ok) return g.response;
  return cancelarPorElCerebro(req, g.ambito.organizationId);
}
