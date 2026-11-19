import { citasParaElCerebro } from "@/server/brains/agenda";
import { withBrainAgenda } from "@/server/brains/http";

export const dynamic = "force-dynamic";

/** 070 — `GET /api/brains/agenda/bookings?conversationId=…` (forma v2, sin anunciar). */
export const GET = withBrainAgenda((req, ambito) => citasParaElCerebro(req, ambito.organizationId));
