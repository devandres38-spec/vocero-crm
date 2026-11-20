import { and, desc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { apiError, parseBody } from "@/lib/api";
import { upsertFicha } from "@/server/bot/ficha";
import { toHandoffReason } from "@/server/bot/handoff";
import { moverEtapaPorElCerebro } from "@/server/bot/stage";
import { publish } from "@/server/events/bus";
import { registrarBaja } from "@/server/bajas";
import { notaDeHandoff } from "@/server/incidentes";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";
import { graphRequest } from "@/lib/meta/client";

/**
 * 070 (D5) — Las acciones de un cerebro sobre UNA conversación, con la
 * organización ya resuelta por quien autenticó: `/api/bot/*` (la de la
 * instancia) o `/api/brains/*` (la del ámbito de la credencial). El cuerpo,
 * los códigos y las respuestas son los de `/api/bot/*`; ver cada ruta para el
 * contrato de cada una.
 *
 * Toda consulta filtra por `organizationId`: una conversación de otra
 * organización es 404, igual que una que no existe.
 */

/**
 * Auditoría 070 (M-5) — Opciones del núcleo. `exigirIa`: rechazar con 409
 * `ai_paused` si un humano ya tomó la conversación (`/api/brains/*`; una
 * llamada tardía del cerebro no puede pisar lo que hace la persona).
 * `/api/bot/*` no lo pide: su contrato en `single` no cambia.
 */
export type OpcionesNucleo = { exigirIa?: boolean };

export const IA_PAUSADA = "La IA está en pausa en esta conversación";

const fichaSchema = z.object({
  // Auditoría 070 (M-11): con tope.
  conversationId: z.string().min(1).max(128),
  // Objeto libre a propósito: las claves las define el negocio, y el servidor
  // tolera el drift del LLM en vez de castigarlo con un 422 (ver server/bot/ficha).
  ficha: z.record(z.string(), z.unknown()),
});

/** Ficha: merge campo a campo; `null` borra. Devuelve la ficha COMPLETA. */
export async function escribirFicha(
  req: Request,
  organizationId: string,
  opts: OpcionesNucleo = {}
): Promise<Response> {
  const body = await parseBody(req, fichaSchema);
  if (!body.ok) return body.response;

  const rows = await getDb()
    .select({
      contactId: schema.conversation.contactId,
      aiEnabled: schema.conversation.aiEnabled,
      handoffAt: schema.conversation.handoffAt,
    })
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, body.data.conversationId)
      )
    )
    .limit(1);
  if (!rows[0]) return apiError(404, "not_found", "Conversación no encontrada");
  if (opts.exigirIa && (!rows[0].aiEnabled || rows[0].handoffAt)) {
    return apiError(409, "ai_paused", IA_PAUSADA);
  }

  const result = await upsertFicha({
    organizationId,
    contactId: rows[0].contactId,
    ficha: body.data.ficha,
  });
  if (!result) return apiError(404, "not_found", "Contacto no encontrado");
  return Response.json(result);
}

const etapaSchema = z.object({
  conversationId: z.string().min(1).max(128),
  /** Nombre de la etapa (como viene en `lead.nextStages` del contexto) o su id. */
  stage: z.string().min(1).max(200),
});

/** 038 — Mover al lead hacia adelante en el pipeline. */
export async function moverEtapa(req: Request, organizationId: string): Promise<Response> {
  const body = await parseBody(req, etapaSchema);
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

const handoffSchema = z.object({
  conversationId: z.string().min(1).max(128),
  /**
   * Texto libre a propósito: el catálogo se aplica después, con fallback
   * (ver `server/bot/handoff`). Un motivo raro no puede costar el handoff:
   * por eso uno largo se RECORTA a 200 (auditoría 070, M-11) en vez de
   * rechazarse.
   */
  reason: z
    .string()
    .max(4000)
    .optional()
    .transform((r) => (r === undefined ? r : r.slice(0, 200))),
  /**
   * 073-B (D2) — Resumen breve para el equipo; queda como nota interna. Como
   * el motivo, uno largo se RECORTA (500) en vez de costar el handoff.
   */
  summary: z
    .string()
    .max(4000)
    .optional()
    .transform((r) => (r === undefined ? r : r.slice(0, 500))),
});

/** Handoff: pausa la IA. Idempotente (solo escribe en la transición). */
export async function pasarAHumanoPorElCerebro(
  req: Request,
  organizationId: string
): Promise<Response> {
  const body = await parseBody(req, handoffSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const rows = await db
    .select({
      id: schema.conversation.id,
      handoffAt: schema.conversation.handoffAt,
    })
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, body.data.conversationId)
      )
    )
    .limit(1);
  const conv = rows[0];
  if (!conv) return apiError(404, "not_found", "Conversación no encontrada");

  const motivo = toHandoffReason(body.data.reason);
  // 073-B (D6) — El agente detectó una baja (herramienta `solicitar_baja`):
  // el CRM la registra, confirma al cliente con el texto fijo y pausa.
  if (motivo === "opt_out") {
    await registrarBaja({ organizationId, conversationId: conv.id, origen: "agente" });
  }

  if (!conv.handoffAt) {
    await db
      .update(schema.conversation)
      .set({
        aiEnabled: false,
        handoffAt: new Date(),
        handoffReason: motivo,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.conversation.organizationId, organizationId),
          eq(schema.conversation.id, conv.id)
        )
      );
    publish(organizationId, {
      type: "conversation.updated",
      data: { conversation: { id: conv.id } },
    });
  }
  // 073-B (D2): el resumen llega aunque la conversación ya estuviera pausada
  // (un handoff encolado que entra tarde sigue sirviéndole al equipo).
  if (body.data.summary?.trim()) {
    await notaDeHandoff({ organizationId, conversationId: conv.id, resumen: body.data.summary });
  }
  return Response.json({ ok: true });
}

const typingSchema = z.object({ conversationId: z.string().min(1).max(128) });

/**
 * «Escribiendo…» + marcar leído el último inbound. Best-effort: si Meta
 * falla, 200 `{ok:false}` y la conversación sigue.
 */
export async function marcarEscribiendo(req: Request, organizationId: string): Promise<Response> {
  const body = await parseBody(req, typingSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const convs = await db
    .select()
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, body.data.conversationId)
      )
    )
    .limit(1);
  const conv = convs[0];
  if (!conv) return apiError(404, "not_found", "Conversación no encontrada");
  if (conv.isTest) {
    // Sandbox: jamás toca la API real (guardrail del Laboratorio).
    return Response.json({ ok: false, reason: "sandbox" });
  }
  if (!conv.aiEnabled || conv.handoffAt) {
    // Handoff/IA pausada: un humano atiende — "escribiendo…" aquí sería
    // mentirle al cliente. Se omite sin tocar Meta.
    return Response.json({ ok: false, reason: "ai_paused" });
  }
  if (conv.channel !== "whatsapp") {
    // 2.13.1 — Esto es la Graph API de WhatsApp. En Instagram, Messenger o
    // TikTok (Zernio) se buscaban las credenciales de WhatsApp y se le mandaba
    // a Meta el id de un mensaje de otro canal: 409 `no_connection` o
    // `meta_error` en cada turno. Best-effort como siempre; sin `reason`
    // nuevo para no tocar el enum del contrato.
    return Response.json({ ok: false });
  }

  const msgs = await db
    .select({ waMessageId: schema.message.waMessageId })
    .from(schema.message)
    .where(
      and(
        eq(schema.message.organizationId, organizationId),
        eq(schema.message.conversationId, conv.id),
        eq(schema.message.direction, "in"),
        isNotNull(schema.message.waMessageId)
      )
    )
    .orderBy(desc(schema.message.createdAt))
    .limit(1);
  const wamid = msgs[0]?.waMessageId;
  if (!wamid) return Response.json({ ok: false, reason: "no_inbound" });

  const creds = await getCredentialsByOrg(organizationId);
  if (!creds) {
    return apiError(409, "no_connection", "WhatsApp no está conectado");
  }

  try {
    await graphRequest(`${creds.phoneNumberId}/messages`, {
      method: "POST",
      token: creds.token,
      body: {
        messaging_product: "whatsapp",
        status: "read",
        message_id: wamid,
        typing_indicator: { type: "text" },
      },
    });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, reason: "meta_error" });
  }
}
