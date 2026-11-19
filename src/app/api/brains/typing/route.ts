import { withBrain } from "@/server/brains/http";
import { marcarEscribiendo } from "@/server/bot/nucleo/acciones";

export const dynamic = "force-dynamic";

/** 070 — `POST /api/brains/typing`: igual que `/api/bot/typing`, en el ámbito del cerebro. */
export const POST = withBrain((req, ambito) => marcarEscribiendo(req, ambito.organizationId));
