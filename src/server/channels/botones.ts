import type { Channel } from "@/lib/channels";
import { MAX_ID_BOTON } from "@/server/bot/mensaje-del-bot";
import { capabilitiesFor } from "@/server/channels/capabilities";

/**
 * 077 — ¿Puede salir un mensaje con botones por esta conversación? El canal
 * tiene que admitirlos y la conexión tiene que ser directa con Meta: por
 * Zernio no (su API no documenta los Quick Replies), ni sin conexión.
 */
export function admiteBotones(canal: Channel, fuente: "meta" | "zernio" | null): boolean {
  return capabilitiesFor(canal).buttons && fuente === "meta";
}

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
