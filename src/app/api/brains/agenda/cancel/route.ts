import { cancelarPorElCerebro } from "@/server/brains/agenda";
import { withBrainAgenda } from "@/server/brains/http";

export const dynamic = "force-dynamic";

/** 070 — `POST /api/brains/agenda/cancel` (forma v2, sin anunciar). Ver `src/server/brains/agenda.ts`. */
export const POST = withBrainAgenda((req, ambito) => cancelarPorElCerebro(req, ambito.organizationId));
