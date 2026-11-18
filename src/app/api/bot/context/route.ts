import { apiError } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { contextoDeConversacion } from "@/server/bot/nucleo/contexto";

export const dynamic = "force-dynamic";

/**
 * Contexto conversacional para un cerebro externo (solo lectura).
 * GET /api/bot/context?identity=... | ?waIdentity=... | ?conversationId=...
 *
 * `identity` es el nombre neutro (hay contactos que no son de WhatsApp).
 * `waIdentity` se mantiene aceptado y presente en la respuesta porque es
 * contrato publicado: hay cerebros externos en produccion que dependen de el.
 * No tiene fecha de retiro.
 *
 * NO devuelve el historial de mensajes: el bot lleva su propia memoria de la
 * conversación. Lo que aquí sale es lo que solo el CRM sabe — quién es la
 * persona, si un humano tomó el control y si la ventana de 24 h sigue abierta
 * (y, con la agenda encendida, qué citas tiene: `booking`).
 *
 * 031 — `adOrigen`: de qué anuncio llegó la persona, o `null`. Antes un
 * cerebro delante del CRM lo leía del `referral` del webhook de Meta; con el
 * despacho el webhook ya no le llega, y esto es lo que lo reemplaza. Misma
 * llave y misma forma que en Vocero Cloud. El `ctwa_clid` no sale: solo si
 * existe.
 *
 * 038 — `lead.nextStages`: a qué etapas puede mover el cerebro al lead con
 * `POST /api/bot/stage` (las abiertas después de la actual, en orden). Va
 * aquí y no en el perfil porque depende de la etapa de este momento.
 *
 * 070 — El cuerpo lo arma `src/server/bot/nucleo/contexto.ts`, compartido con
 * `/api/brains/context` (que añade `agent`, `knowledge` y `llm`).
 */
export async function GET(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;

  const organizationId = await resolveInstanceOrg();
  if (!organizationId) {
    return apiError(409, "no_org", "La instancia aún no tiene organización");
  }

  const url = new URL(req.url);
  const waIdentity =
    url.searchParams.get("identity") ?? url.searchParams.get("waIdentity");
  const conversationId = url.searchParams.get("conversationId");
  if (!waIdentity && !conversationId) {
    return apiError(422, "invalid", "Falta identity (o waIdentity) o conversationId");
  }

  const cuerpo = await contextoDeConversacion(
    organizationId,
    conversationId ? { conversationId } : { identity: waIdentity as string }
  );
  if (!cuerpo) {
    return apiError(404, "not_found", "Conversación no encontrada");
  }
  return Response.json(cuerpo);
}
