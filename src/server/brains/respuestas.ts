import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { apiError } from "@/lib/api";
import type { AmbitoCerebro } from "@/server/brains/auth";
import { cuerpoRespuestaCerebro, responderComoCerebro } from "@/server/bot/nucleo/mensajes";

/**
 * 070 (contrato §2.2) — `POST /api/brains/messages`: responder por un cerebro.
 *
 * Lo que añade sobre `/api/bot/messages`:
 * - **`dispatchId` obligatorio** y de ESTA organización y ESTA conversación
 *   (de las últimas 24 h y no descartado). Sin eso, 422 `despacho_desconocido`:
 *   un cerebro no puede escribir en una conversación que nadie le despachó.
 * - **Reasignación**: si ese despacho lo recibió OTRO despliegue, 409
 *   `cerebro_reasignado` y no se envía (la respuesta tardía de un cerebro viejo).
 * - **Idempotencia** por `(organización, dispatchId, sha256(texto))` en
 *   `brain_reply`: un turno puede mandar varios textos por despacho, pero el
 *   reintento del MISMO texto devuelve el mensaje ya creado (200) sin
 *   reenviarlo. El primero responde 201.
 * - Ventana cerrada → **422 `fuera_de_ventana`** (Nea lo traduce a
 *   `window_closed` y calla, en vez de reintentar).
 */

export const cuerpoMensajeCerebro = cuerpoRespuestaCerebro.extend({
  dispatchId: z.string().min(1).max(128),
});

export type CuerpoMensajeCerebro = z.infer<typeof cuerpoMensajeCerebro>;

/** Cuánto tiempo después de despachado se acepta una respuesta. */
export const VIGENCIA_RESPUESTA_MS = 24 * 60 * 60 * 1000;

export function hashTexto(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex");
}

export async function responderPorElCerebro(
  ambito: AmbitoCerebro,
  body: CuerpoMensajeCerebro,
  ahora: Date = new Date()
): Promise<Response> {
  const db = getDb();
  const { organizationId } = ambito;

  const [despacho] = await db
    .select({
      conversationId: schema.dispatch.conversationId,
      status: schema.dispatch.status,
      createdAt: schema.dispatch.createdAt,
      brainDeploymentId: schema.dispatch.brainDeploymentId,
    })
    .from(schema.dispatch)
    .where(and(eq(schema.dispatch.organizationId, organizationId), eq(schema.dispatch.id, body.dispatchId)))
    .limit(1);
  if (
    !despacho ||
    despacho.conversationId !== body.conversationId ||
    despacho.status === "descartado" ||
    ahora.getTime() - despacho.createdAt.getTime() > VIGENCIA_RESPUESTA_MS
  ) {
    return apiError(422, "despacho_desconocido", "Ese despacho no existe para esta conversación");
  }
  if (despacho.brainDeploymentId && despacho.brainDeploymentId !== ambito.deploymentId) {
    return apiError(409, "cerebro_reasignado", "Este negocio ya lo atiende otro cerebro");
  }

  const textHash = hashTexto(body.text);
  const [previa] = await db
    .select({ messageId: schema.brainReply.messageId })
    .from(schema.brainReply)
    .where(
      and(
        eq(schema.brainReply.organizationId, organizationId),
        eq(schema.brainReply.dispatchId, body.dispatchId),
        eq(schema.brainReply.textHash, textHash)
      )
    )
    .limit(1);
  if (previa) return Response.json({ ok: true, messageId: previa.messageId, replayed: true });

  const r = await responderComoCerebro({
    organizationId,
    conversationId: body.conversationId,
    text: body.text,
  });
  if (r.ok) {
    await db
      .insert(schema.brainReply)
      .values({ organizationId, dispatchId: body.dispatchId, textHash, messageId: r.messageId })
      .onConflictDoNothing();
    return Response.json({ ok: true, messageId: r.messageId }, { status: 201 });
  }
  switch (r.code) {
    case "not_found":
      return apiError(404, "not_found", r.message);
    case "window_closed":
      return apiError(422, "fuera_de_ventana", r.message);
    case "ai_paused":
      return apiError(409, "ai_paused", r.message);
    case "sandbox_violation":
      return apiError(409, "sandbox_violation", r.message);
    case "message_limit":
      return apiError(409, "message_limit", r.message);
    case "text_too_long":
      return apiError(422, "invalid_body", r.message);
    case "send_failed":
      return apiError(502, r.detalle ?? "send_failed", r.message);
  }
}
