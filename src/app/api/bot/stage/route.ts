import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { requireBot } from "@/server/bot/auth";
import { rutaDelCerebro } from "@/server/bot/ruta";
import { moverEtapaPorElCerebro } from "@/server/bot/stage";
import { publish } from "@/server/events/bus";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  conversationId: z.string().min(1),
  /** Nombre de la etapa (como viene en `lead.nextStages` del contexto) o su id. */
  stage: z.string().min(1).max(200),
});

/**
 * 038 — El cerebro mueve al lead a la etapa siguiente del pipeline.
 *
 * Solo hacia adelante y a etapas abiertas, con la herramienta `etapa`
 * encendida y la IA activa en la conversación (reglas en
 * `src/server/bot/stage.ts`). Idempotente: la etapa actual da 200 con
 * `changed: false`. Los 409 y 422 traen en el mensaje las etapas válidas,
 * para que el modelo se corrija en el mismo turno.
 */
async function postSinNegocio(req: Request) {
  const auth = await requireBot(req);
  if (auth instanceof Response) return auth;

  const { organizationId } = auth;

  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const res = await moverEtapaPorElCerebro({ organizationId, ...body.data });
  if (!res.ok) return apiError(res.status, res.code, res.message);

  if (res.changed) {
    // Como cuando el dueño arrastra la tarjeta: la bandeja y el Pipeline lo
    // ven en vivo.
    publish(organizationId, {
      type: "conversation.updated",
      data: { conversation: { id: res.conversationId } },
    });
  }
  return Response.json({ ok: true, changed: res.changed, lead: res.lead });
}

// 075 — Autentica el negocio y corre la ruta dentro de él (RLS).
export const POST = rutaDelCerebro(postSinNegocio);
