import { MAX_ID_BOTON } from "@/server/bot/mensaje-del-bot";

/**
 * 077 — El id del botón que tocó el cliente en Instagram o Messenger (Quick
 * Replies de Meta): llega en `message.quick_reply.payload`, y `message.text`
 * trae el título. Un `payload` vacío o más largo que los nuestros (256) no se
 * guarda como botón: el mensaje entra como texto normal.
 */
export function botonDeQuickReply(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;
  const qr = (message as { quick_reply?: unknown }).quick_reply;
  if (!qr || typeof qr !== "object") return null;
  const payload = (qr as { payload?: unknown }).payload;
  return typeof payload === "string" && payload.length > 0 && payload.length <= MAX_ID_BOTON
    ? payload
    : null;
}
