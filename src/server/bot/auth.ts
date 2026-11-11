import { timingSafeEqual } from "node:crypto";
import { apiError } from "@/lib/api";
import { credencialDerivada } from "@/server/brains/credencial";
import { hastaDosOrganizaciones, organizacionExiste } from "@/server/bot/organizaciones";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { markBotSeen } from "@/server/bot/status";

/**
 * Autenticación de la API de servicio `/api/bot/*`.
 *
 * 073 (D13 de Aliantis; contrato 067, `bot-api-v2.md` §1) — POR NEGOCIO. El
 * cerebro manda `X-Vocero-Organization: <org id>` y la credencial derivada de
 * ese negocio (`credencialDerivada`). Sin la cabecera, la `BOT_API_KEY` cruda
 * solo vale si la instalación tiene UN negocio (compatibilidad, con aviso en el
 * registro); con dos o más, 409. Lo de antes (la primera organización
 * de la tabla) ya no existe.
 *
 * Esta superficie NO la consume el navegador: la consume un cerebro externo
 * (un microservicio propio del operador, en su mismo servidor) que quiere
 * conducir la conversación sin que el token de WhatsApp salga del CRM.
 * Header `X-API-Key` (o `Authorization: Bearer`) contra `BOT_API_KEY` (env),
 * comparación en tiempo constante. Sin `BOT_API_KEY` configurada, toda la superficie responde 401.
 *
 * Primero se autentica y DESPUÉS se cuenta. Antes había un solo cubo global
 * contado antes de mirar la key: 600 requests anónimos por minuto dejaban al
 * cerebro en 429 el resto de la ventana, y los clientes sin respuesta.
 */

const MIN_KEY_LENGTH = 16;

/** La superficie está abierta: hay `BOT_API_KEY` y no es débil. Una key
 *  corta equivale a no tenerla (todo responde 401). */
export function isBotKeyConfigured(): boolean {
  const key = process.env.BOT_API_KEY;
  return typeof key === "string" && key.length >= MIN_KEY_LENGTH;
}

/**
 * Presupuesto del cerebro AUTENTICADO, POR NEGOCIO (073): 1200/min (20/s sostenidos). Nea hace
 * ~4-10 llamadas por turno de cliente (contexto, "escribiendo…", 1-3
 * mensajes y, cuando aplica, ficha, handoff, agenda o adjuntos): alcanza para
 * 120-300 turnos por minuto, por encima del pico de un solo negocio. Un
 * cerebro desbocado en un bucle queda en 20/s, carga que el monolito absorbe
 * sin que la bandeja lo note.
 */
export const BOT_API_BUDGET = { windowMs: 60_000, max: 1200 };

/**
 * Autenticaciones FALLIDAS por IP: 30/min, y luego 429. Jamás tocan el
 * presupuesto de arriba, y una key correcta pasa aunque su IP esté frenada:
 * detrás del mismo proxy (o sin proxy, donde todo es "local") el cerebro puede
 * compartir IP con quien inunda. Adivinar la key tampoco es el riesgo: mide
 * 16+ caracteres.
 */
export const BOT_AUTH_FAILURES = { windowMs: 60_000, max: 30 };

/**
 * 036 — La llave llega en `X-API-Key` o, para `/api/bot/llm`, como
 * `Authorization: Bearer`: es lo que manda el SDK de OpenAI del cerebro, que
 * apunta su `base_url` al CRM y no sabe de cabeceras propias.
 */
function llaveDe(req: Request): string | null {
  const directa = req.headers.get("x-api-key");
  if (directa) return directa;
  const auth = req.headers.get("authorization");
  const m = auth ? /^Bearer\s+(.+)$/i.exec(auth.trim()) : null;
  return m?.[1] ?? null;
}

export type BotAuth = { organizationId: string };

const CABECERA_ORGANIZACION = "x-vocero-organization";
/** Los ids de organización (`org_…`): letras, números, guion y guion bajo. */
const ORGANIZATION_ID = /^[A-Za-z0-9_-]{1,128}$/;
/** El aviso de la llave cruda, como mucho uno por minuto (no inunda el registro). */
const AVISO_COMPATIBILIDAD_MS = 60_000;
const g = globalThis as unknown as { __voceroAvisoLlaveCruda?: number };

function iguales(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function rechazar(req: Request): Response {
  const ip = clientIp(req.headers);
  const fails = checkRateLimit(`bot-api-fail:${ip}`, BOT_AUTH_FAILURES);
  return fails.allowed
    ? apiError(401, "unauthorized", "No autorizado")
    : apiError(429, "rate_limited", "Demasiados intentos fallidos");
}

function avisarLlaveCruda(): void {
  const ahora = Date.now();
  if (ahora - (g.__voceroAvisoLlaveCruda ?? 0) < AVISO_COMPATIBILIDAD_MS) return;
  g.__voceroAvisoLlaveCruda = ahora;
  console.warn(
    "[bot] Un cerebro usa la BOT_API_KEY cruda sin X-Vocero-Organization (compatibilidad con un solo negocio). " +
      "Con un segundo negocio responderá 409: debe usar la credencial derivada."
  );
}

/**
 * La organización de la petición, con las seis reglas del contrato:
 * cabecera + su credencial → esa; cabecera + otra credencial o la llave cruda
 * → 401; cabecera de un negocio que no existe → 401 (no revela si existe); sin
 * cabecera + llave cruda con un negocio → ese; con dos o más → 409; sin llave
 * válida → 401 con freno por IP. Comparación en tiempo constante.
 */
export async function requireBot(req: Request): Promise<BotAuth | Response> {
  const secreto = process.env.BOT_API_KEY;
  const llave = llaveDe(req);
  if (!secreto || !isBotKeyConfigured() || !llave) return rechazar(req);

  let organizationId: string;
  const cabecera = req.headers.get(CABECERA_ORGANIZACION)?.trim();
  if (cabecera) {
    if (!ORGANIZATION_ID.test(cabecera)) return rechazar(req);
    if (!iguales(llave, credencialDerivada(secreto, cabecera))) return rechazar(req);
    if (!(await organizacionExiste(cabecera))) return rechazar(req);
    organizationId = cabecera;
  } else {
    if (!iguales(llave, secreto)) return rechazar(req);
    const organizaciones = await hastaDosOrganizaciones();
    if (organizaciones.length === 0) {
      return apiError(409, "no_org", "La instancia aún no tiene organización");
    }
    if (organizaciones.length > 1) {
      return apiError(
        409,
        "organizacion_requerida",
        "Hay varios negocios: manda X-Vocero-Organization y la credencial derivada de ese negocio"
      );
    }
    organizationId = organizaciones[0]!;
    avisarLlaveCruda();
  }

  // «Quién responde»: la huella que deja el cerebro en el CRM, por negocio. Se
  // marca al autenticar, antes del presupuesto: un cerebro frenado por 429
  // sigue siendo el que contesta.
  markBotSeen(organizationId);
  const rl = checkRateLimit(`bot-api:${organizationId}`, BOT_API_BUDGET);
  if (!rl.allowed) return apiError(429, "rate_limited", "Demasiadas solicitudes");
  return { organizationId };
}

/** Solo para tests. */
export function resetAvisoLlaveCruda(): void {
  delete g.__voceroAvisoLlaveCruda;
}
