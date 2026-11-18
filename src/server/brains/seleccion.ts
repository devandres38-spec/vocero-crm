import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";

/**
 * 070 (contrato §3) — `selectionToken`: la cita que el cliente eligió en
 * `GET /api/brains/agenda/bookings`, para cancelarla (agenda v2).
 *
 * Opaco para el cerebro y atado a TRES cosas: la organización (va en la
 * firma, no en el cuerpo), la conversación y la revisión de la cita (su
 * `updatedAt`). Con el de otra organización la firma no cuadra; si la cita
 * cambió desde que se listó, la revisión no cuadra (`stale_selection`).
 *
 * `base64url(JSON{b,c,r}).base64url(HMAC-SHA256(BETTER_AUTH_SECRET, dominio))`.
 */

const DOMINIO = "aliantis-seleccion:v1";

export type Seleccion = { bookingId: string; conversationId: string; revision: number };

function firma(organizationId: string, cuerpo: string, secreto: string): string {
  return createHmac("sha256", secreto).update(`${DOMINIO}:${organizationId}:${cuerpo}`, "utf8").digest("base64url");
}

export function firmarSeleccion(
  organizationId: string,
  s: Seleccion,
  secreto: string = getEnv().BETTER_AUTH_SECRET
): string {
  const cuerpo = Buffer.from(JSON.stringify({ b: s.bookingId, c: s.conversationId, r: s.revision }), "utf8").toString("base64url");
  return `${cuerpo}.${firma(organizationId, cuerpo, secreto)}`;
}

/** `null` si no es de esta organización, está alterado o mal formado. */
export function leerSeleccion(
  organizationId: string,
  token: string,
  secreto: string = getEnv().BETTER_AUTH_SECRET
): Seleccion | null {
  if (typeof token !== "string" || token.length > 512) return null;
  const [cuerpo, sello, sobra] = token.split(".");
  if (!cuerpo || !sello || sobra !== undefined) return null;
  const esperado = Buffer.from(firma(organizationId, cuerpo, secreto));
  const recibido = Buffer.from(sello);
  if (esperado.length !== recibido.length || !timingSafeEqual(esperado, recibido)) return null;
  try {
    const d = JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof d.b !== "string" || typeof d.c !== "string" || typeof d.r !== "number") return null;
    return { bookingId: d.b, conversationId: d.c, revision: d.r };
  } catch {
    return null;
  }
}
