import { filtrarTarjetas, filtrarUbicacion } from "./adjuntos";
import { filtrarTexto, unirMarcas } from "./filtrar";
import type { PrivacyPolicy } from "./privacy-filter";

/**
 * 069 — El payload de un webhook, filtrado antes de guardarse en
 * `webhook_event` (D1 a D4 y D9 de la spec).
 *
 * 1. Por forma: el texto de cada mensaje de paciente (WhatsApp, Meta y Zernio;
 *    las formas no se pisan, así que se aplican las tres) se filtra y el
 *    mensaje queda anotado con sus marcas en `_privacidad`.
 * 2. Red de seguridad: cualquier `body`, `text`, `caption`, `title` o
 *    `description` que quede sin revisar se filtra igual (sin marcas). Nunca
 *    entra en la tarjeta del anuncio (`referral`), en los ecos del teléfono del
 *    negocio, en los estados ni en los errores de Meta.
 *
 * Pura: devuelve una copia y no toca el original.
 */

/** Dónde quedan las marcas de cada mensaje de paciente dentro del payload. */
export const CLAVE_MARCAS = "_privacidad";

const CAMPOS_DE_TEXTO = new Set(["body", "text", "caption", "title", "description"]);

/**
 * Lo que la red de seguridad nunca toca (ajuste de Andres, 10-nov-2026): la
 * tarjeta del anuncio, los ecos del teléfono del negocio (`smb_message_echoes`
 * trae sus mensajes en `message_echoes`), los estados de entrega y los errores
 * de Meta, y los metadatos del número.
 */
const NUNCA = new Set(["referral", "message_echoes", "statuses", "errors", "metadata", CLAVE_MARCAS]);

/** Tipos de WhatsApp con archivo y pie de foto. */
const MEDIOS = ["image", "video", "document", "audio", "sticker"] as const;

type Obj = Record<string, unknown>;

const esObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const cadena = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export function filtrarPayload(payload: unknown, politica: PrivacyPolicy | null): unknown {
  const copia: unknown = structuredClone(payload);
  // Qué campos ya revisó el filtro por forma, por objeto: la red no los repite
  // (un botón conservado sin perfil no debe volverse "no se pudo revisar").
  const revisados = new WeakMap<Obj, Set<string>>();

  const filtrarCampo = (o: Obj, campo: string, botonId?: string | null): string[] => {
    const valor = o[campo];
    if (typeof valor !== "string") return [];
    const r = filtrarTexto(valor, politica, botonId);
    o[campo] = r.text;
    const hechos = revisados.get(o) ?? new Set<string>();
    hechos.add(campo);
    revisados.set(o, hechos);
    return r.marcas;
  };

  if (esObj(copia)) {
    // WhatsApp Cloud API: solo `field: "messages"` trae mensajes de pacientes.
    for (const entry of lista(copia.entry)) {
      if (!esObj(entry)) continue;
      for (const change of lista(entry.changes)) {
        if (!esObj(change) || change.field !== "messages" || !esObj(change.value)) continue;
        for (const msg of lista(change.value.messages)) {
          if (esObj(msg)) filtrarMensajeWhatsapp(msg, filtrarCampo, politica);
        }
      }
      // Meta (Instagram y Messenger): `entry[].messaging[]`; los ecos no.
      for (const evento of lista(entry.messaging)) {
        if (!esObj(evento) || !esObj(evento.message) || evento.message.is_echo === true) continue;
        const message = evento.message;
        const botonId = esObj(message.quick_reply) ? cadena(message.quick_reply.payload) : null;
        message[CLAVE_MARCAS] = unirMarcas(filtrarCampo(message, "text", botonId));
      }
    }
    // Zernio (Instagram, Messenger, TikTok): un evento por entrega; lo saliente no.
    if (typeof copia.event === "string" && esObj(copia.message)) {
      const message = copia.message;
      if (message.direction !== "outgoing") {
        message[CLAVE_MARCAS] = unirMarcas(filtrarCampo(message, "text"));
      }
    }
  }

  barrer(copia, (o, campo) => {
    if (revisados.get(o)?.has(campo)) return;
    filtrarCampo(o, campo);
  });
  return copia;
}

function filtrarMensajeWhatsapp(
  msg: Obj,
  filtrarCampo: (o: Obj, campo: string, botonId?: string | null) => string[],
  politica: PrivacyPolicy | null
): void {
  const marcas: string[][] = [];
  if (esObj(msg.text)) marcas.push(filtrarCampo(msg.text, "body"));
  // Respuesta a un botón de plantilla: el rótulo se conserva sin perfil.
  if (esObj(msg.button)) {
    const id = cadena(msg.button.payload) ?? cadena(msg.button.text);
    marcas.push(filtrarCampo(msg.button, "text", id));
  }
  if (esObj(msg.interactive)) {
    for (const clave of ["button_reply", "list_reply"] as const) {
      const respuesta = msg.interactive[clave];
      if (!esObj(respuesta)) continue;
      const id = cadena(respuesta.id) ?? cadena(respuesta.title);
      marcas.push(filtrarCampo(respuesta, "title", id));
      marcas.push(filtrarCampo(respuesta, "description", id));
    }
  }
  for (const medio of MEDIOS) {
    const adjunto = msg[medio];
    if (esObj(adjunto)) marcas.push(filtrarCampo(adjunto, "caption"));
  }
  // 070 (D4): el nombre del archivo lo escribió el paciente.
  if (esObj(msg.document)) marcas.push(filtrarCampo(msg.document, "filename"));
  // 070 (D4): ubicación y tarjetas de contacto, por lista blanca.
  if (esObj(msg.location)) {
    const r = filtrarUbicacion(msg.location, politica);
    msg.location = r.payload;
    marcas.push(r.marcas);
  }
  if (Array.isArray(msg.contacts)) {
    const r = filtrarTarjetas(msg.contacts, politica);
    msg.contacts = r.payload;
    marcas.push(r.marcas);
  }
  msg[CLAVE_MARCAS] = unirMarcas(...marcas);
}

/** La red de seguridad: recorre todo salvo lo que nunca se toca. */
function barrer(valor: unknown, filtrar: (o: Obj, campo: string) => void): void {
  if (Array.isArray(valor)) {
    for (const v of valor) barrer(v, filtrar);
    return;
  }
  if (!esObj(valor)) return;
  // Un eco de Meta o lo saliente de Zernio: lo escribió el negocio.
  if (valor.is_echo === true || valor.direction === "outgoing") return;
  for (const [campo, v] of Object.entries(valor)) {
    if (NUNCA.has(campo)) continue;
    if (typeof v === "string") {
      if (CAMPOS_DE_TEXTO.has(campo)) filtrar(valor, campo);
    } else {
      barrer(v, filtrar);
    }
  }
}

/** Las marcas que dejó `filtrarPayload` en un mensaje, o null si no pasó por él. */
export function marcasDe(mensaje: unknown): string[] | null {
  if (!esObj(mensaje)) return null;
  const marcas = mensaje[CLAVE_MARCAS];
  return Array.isArray(marcas) && marcas.every((m) => typeof m === "string")
    ? (marcas as string[])
    : null;
}
