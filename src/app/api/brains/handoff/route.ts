import { withBrain } from "@/server/brains/http";
import { pasarAHumanoPorElCerebro } from "@/server/bot/nucleo/acciones";

export const dynamic = "force-dynamic";

/** 070 — `POST /api/brains/handoff`: igual que `/api/bot/handoff`, en el ámbito del cerebro. */
export const POST = withBrain((req, ambito) => pasarAHumanoPorElCerebro(req, ambito.organizationId));
