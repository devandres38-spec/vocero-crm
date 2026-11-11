import { getEnv } from "@/lib/env";
import { isValidWebhookToken } from "@/server/inbox/webhook";
import { verificarFirmaMeta } from "@/server/webhooks/firma";
import { recibirEvento } from "@/server/webhooks/recibir";
import { webhookEntrante } from "@/server/webhooks/entrada";

/**
 * Webhook público de WhatsApp (contrato webhook.md).
 * Capa 1: el segmento [webhookToken] debe coincidir (si no → 404 sin efectos).
 * Capa 2 (073): firma x-hub-signature-256 con el App Secret de WhatsApp del
 * negocio al que va la entrega (`webhooks/firma.ts`); obligatoria en producción.
 * 047: tras validar, el evento se guarda ANTES de responder 200 y se procesa
 * fuera de la ruta; si falla, el barrido lo reintenta. Si no se pudo guardar,
 * 503 para que Meta reintente (`src/server/webhooks/recibir.ts`).
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ webhookToken: string }> };

export async function GET(req: Request, { params }: Params) {
  const { webhookToken } = await params;
  const env = getEnv();
  if (!isValidWebhookToken(webhookToken, env.META_WEBHOOK_VERIFY_TOKEN)) {
    return new Response(null, { status: 404 });
  }

  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === env.META_WEBHOOK_VERIFY_TOKEN) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response(null, { status: 403 });
}

async function postSinNegocio(req: Request, { params }: Params) {
  const { webhookToken } = await params;
  const env = getEnv();
  if (!isValidWebhookToken(webhookToken, env.META_WEBHOOK_VERIFY_TOKEN)) {
    return new Response(null, { status: 404 });
  }

  const rawBody = await req.text();
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // body ilegible: 200 igualmente (Meta reintenta y termina desactivando).
    // Nada se guarda: no se puede saber de qué negocio es.
    return Response.json({ received: true });
  }

  // 073: la firma del negocio al que va, ANTES de guardar nada.
  const firma = await verificarFirmaMeta(
    "whatsapp",
    payload,
    rawBody,
    req.headers.get("x-hub-signature-256")
  );
  if (!firma.ok) return new Response(null, { status: 401 });

  return recibirEvento("whatsapp", payload, rawBody, "webhook", {
    organizationId: firma.organizationId,
  });
}

// 075 — Llega sin negocio: modo sistema hasta verificar de quién es.
export const POST = webhookEntrante(postSinNegocio);
