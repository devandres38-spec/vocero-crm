import { MetaApiError } from "@/lib/meta/client";
import type { InstagramCredentials } from "@/server/instagram/credentials";

/**
 * 014 — Frontera de salida del canal de Instagram (Constitución II: todo
 * request a una plataforma pasa por un único módulo).
 *
 * Dos transportes, misma firma: Zernio (API unificada) y Meta directo
 * (graph.instagram.com). Ambos devuelven el id del mensaje en la plataforma.
 */

const ZERNIO_BASE = process.env.ZERNIO_BASE_URL ?? "https://zernio.com/api/v1";
const IG_GRAPH_BASE =
  process.env.IG_GRAPH_BASE_URL ?? "https://graph.instagram.com";
const IG_GRAPH_VERSION = process.env.META_GRAPH_API_VERSION ?? "v25.0";

/** Instagram corta el texto en 1000 BYTES (no caracteres): con acentos y
 * emojis el margen real es menor de lo que aparenta. */
export const IG_TEXT_MAX_BYTES = 1000;

export function fitsInstagramText(text: string): boolean {
  return Buffer.byteLength(text, "utf8") <= IG_TEXT_MAX_BYTES;
}

export type InstagramSendResult = { platformMessageId: string };

/** 077 — Un botón de respuesta (Quick Reply de Meta): `title` hasta 20, `id` hasta 256. */
export type BotonDeMeta = { id: string; title: string };

/**
 * 077 — Los botones como Quick Replies de Meta. Instagram solo admite los de
 * texto (`content_type: "text"`); el `payload` es nuestro id y vuelve en el
 * webhook como `message.quick_reply.payload`. Lo comparte Messenger.
 */
export function quickReplies(botones: readonly BotonDeMeta[]): Record<string, string>[] {
  return botones.map((b) => ({ content_type: "text", title: b.title, payload: b.id }));
}

/**
 * Cuerpo del envío por Meta (graph.instagram.com). Separado para afirmarlo en
 * una prueba sin red. Sin `messaging_type`, como en la documentación de
 * «Instagram API with Instagram Login» (por confirmar en vivo, spec 077).
 */
export function buildInstagramSendBody(input: {
  recipient: string;
  text: string;
  humanAgentTag?: boolean;
  botones?: readonly BotonDeMeta[] | null;
}): Record<string, unknown> {
  const message: Record<string, unknown> = { text: input.text };
  if (input.botones?.length) message.quick_replies = quickReplies(input.botones);
  const body: Record<string, unknown> = { recipient: { id: input.recipient }, message };
  if (input.humanAgentTag) {
    body.messaging_type = "MESSAGE_TAG";
    body.tag = "HUMAN_AGENT";
  }
  return body;
}

/**
 * Envía texto por el transporte que corresponda.
 *
 * `recipient` es el IGSID (sin el prefijo `ig:`); `threadRef` es el
 * conversationId opaco de Zernio, que solo hace falta en ese transporte.
 */
export async function sendInstagramText(input: {
  credentials: InstagramCredentials;
  recipient: string;
  threadRef: string | null;
  text: string;
  /** Fuera de la ventana de 24 h Instagram solo admite HUMAN_AGENT. */
  humanAgentTag?: boolean;
  /** 077 — Solo por Meta: por Zernio, `sendText` ya lo rechazó. */
  botones?: readonly BotonDeMeta[] | null;
}): Promise<InstagramSendResult> {
  if (input.botones?.length && input.credentials.source !== "meta") {
    throw new MetaApiError("Zernio no envía botones", { status: 400 });
  }
  return input.credentials.source === "zernio"
    ? sendViaZernio(input)
    : sendViaMeta(input);
}

async function sendViaZernio(input: {
  credentials: InstagramCredentials;
  recipient: string;
  threadRef: string | null;
  text: string;
  humanAgentTag?: boolean;
}): Promise<InstagramSendResult> {
  const { credentials, threadRef } = input;
  if (!threadRef) {
    throw new MetaApiError(
      "La conversacion no tiene referencia de hilo en Zernio",
      { status: 400 }
    );
  }
  const body: Record<string, unknown> = {
    accountId: credentials.accountRef,
    message: input.text,
  };
  if (input.humanAgentTag) {
    body.messagingType = "MESSAGE_TAG";
    body.messageTag = "HUMAN_AGENT";
  }

  const res = await fetchJson(
    `${ZERNIO_BASE}/inbox/conversations/${encodeURIComponent(threadRef)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  const id =
    (res as { message?: { id?: string }; id?: string }).message?.id ??
    (res as { id?: string }).id ??
    `zernio_${Date.now()}`;
  return { platformMessageId: String(id) };
}

async function sendViaMeta(input: {
  credentials: InstagramCredentials;
  recipient: string;
  text: string;
  humanAgentTag?: boolean;
  botones?: readonly BotonDeMeta[] | null;
}): Promise<InstagramSendResult> {
  const { credentials } = input;
  const body = buildInstagramSendBody(input);

  // El host es graph.instagram.com, NO graph.facebook.com: es el error mas
  // comun de esta integracion y devuelve un fallo de permisos que despista.
  const res = await fetchJson(
    `${IG_GRAPH_BASE}/${IG_GRAPH_VERSION}/${credentials.igUserId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  const id = (res as { message_id?: string }).message_id ?? `ig_${Date.now()}`;
  return { platformMessageId: String(id) };
}

/**
 * Traduce los fallos de ambas plataformas al MetaApiError que el resto del
 * CRM ya sabe interpretar (incluido `isAuthError`, que distingue token muerto
 * de hipo transitorio y costó un incidente aprender).
 */
async function fetchJson(
  url: string,
  init: RequestInit
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (cause) {
    throw new MetaApiError("No se pudo contactar la API de Instagram", {
      status: 0,
      details: cause,
    });
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // respuesta no-JSON: se conserva el texto crudo
  }

  if (!res.ok) {
    const err = json as
      | { error?: { message?: string; code?: number } | string }
      | null;
    const message =
      typeof err?.error === "string"
        ? err.error
        : err?.error?.message ?? `HTTP ${res.status}`;
    const code = typeof err?.error === "object" ? err.error?.code ?? null : null;
    throw new MetaApiError(message, {
      status: res.status,
      code,
      details: json ?? text,
    });
  }
  return json;
}
