import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";

/**
 * 074 (D9, contrato brains-074 §3) — La ficha de un ensayo de «Probar mi
 * agente» (`X-Vocero-Ensayo`).
 *
 * El CRM la firma para UNA organización y UNA conversación sintética
 * (`cv_ensayo_*`), con vida corta; Nea solo la reenvía en sus llamadas a
 * `/api/brains/*`. Con ella el cerebro puede pensar con la llave del negocio
 * y leer huecos de la agenda, y NADA más (`rutaPermitidaEnEnsayo`).
 *
 * `base64url(JSON{c,e,n}).base64url(HMAC-SHA256(BETTER_AUTH_SECRET, dominio:org:cuerpo))`.
 * La organización va en la firma, no en el cuerpo: con la ficha de otra
 * organización la firma no cuadra.
 */

const DOMINIO = "aliantis-ensayo:v1";

/** Lo que dura un ensayo (Nea corta el suyo antes: `ENSAYO_TIMEOUT_SECONDS`). */
export const VIDA_FICHA_ENSAYO_MS = 10 * 60 * 1000;

export const PREFIJO_CONVERSACION_ENSAYO = "cv_ensayo_";

export type FichaEnsayo = { conversationId: string };

function sello(organizationId: string, cuerpo: string, secreto: string): string {
  return createHmac("sha256", secreto).update(`${DOMINIO}:${organizationId}:${cuerpo}`, "utf8").digest("base64url");
}

/** Una conversación sintética nueva (nunca existe en la base). */
export function conversacionDeEnsayo(): string {
  return `${PREFIJO_CONVERSACION_ENSAYO}${randomBytes(9).toString("base64url")}`;
}

export function firmarFichaEnsayo(
  organizationId: string,
  conversationId: string,
  secreto: string = getEnv().BETTER_AUTH_SECRET,
  ahora: number = Date.now()
): string {
  const cuerpo = Buffer.from(
    JSON.stringify({ c: conversationId, e: ahora + VIDA_FICHA_ENSAYO_MS, n: randomBytes(6).toString("base64url") }),
    "utf8"
  ).toString("base64url");
  return `${cuerpo}.${sello(organizationId, cuerpo, secreto)}`;
}

/** `null` si no es de esta organización, está alterada, vencida o mal formada. */
export function leerFichaEnsayo(
  organizationId: string,
  token: string,
  secreto: string = getEnv().BETTER_AUTH_SECRET,
  ahora: number = Date.now()
): FichaEnsayo | null {
  if (typeof token !== "string" || token.length > 512) return null;
  const [cuerpo, firma, sobra] = token.split(".");
  if (!cuerpo || !firma || sobra !== undefined) return null;
  const esperado = Buffer.from(sello(organizationId, cuerpo, secreto));
  const recibido = Buffer.from(firma);
  if (esperado.length !== recibido.length || !timingSafeEqual(esperado, recibido)) return null;
  try {
    const d = JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof d.c !== "string" || !d.c.startsWith(PREFIJO_CONVERSACION_ENSAYO) || d.c.length > 64) return null;
    if (typeof d.e !== "number" || d.e <= ahora) return null;
    return { conversationId: d.c };
  } catch {
    return null;
  }
}

/**
 * Las ÚNICAS rutas de `/api/brains/*` que acepta una ficha de ensayo: pensar
 * y leer huecos. Todo lo demás (mensajes, handoff, ficha, etapa, citas,
 * herramientas de módulo, adjuntos, contexto) responde 403.
 */
export function rutaPermitidaEnEnsayo(pathname: string, metodo: string): boolean {
  if (metodo === "POST" && pathname.startsWith("/api/brains/llm/")) return true;
  if (metodo === "GET" && pathname === "/api/brains/agenda/slots") return true;
  return false;
}
