import { apiError } from "@/lib/api";
import { requireBrain, type AmbitoCerebro } from "@/server/brains/auth";
import { requireBrainAgenda } from "@/server/brains/agenda";
import { rutaPermitidaEnEnsayo } from "@/server/brains/ensayo-ficha";

/**
 * Auditoría 070 (A-7) — El envoltorio de TODA ruta de `/api/brains/*`.
 *
 * Autentica (`requireBrain` o, en la agenda, `requireBrainAgenda`) y captura
 * lo que nadie controló: un fallo transitorio de la base devolvía un 500 sin
 * el sobre JSON que lee Nea. Ahora es `500 internal` con sobre, y el detalle
 * va al log (nunca al cuerpo).
 */

type Manejador<C> = (req: Request, ambito: AmbitoCerebro, ctx: C) => Promise<Response>;
type ManejadorSinContexto = (req: Request, ambito: AmbitoCerebro) => Promise<Response>;

async function seguro(ruta: string, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[brains] ${ruta}: error no controlado —`, err instanceof Error ? err.message : err);
    return apiError(500, "internal", "Error interno");
  }
}

/**
 * 074 (D9) — Con ficha de ensayo solo se piensa y se leen huecos; cualquier
 * otra ruta es 403 aunque la credencial sea buena (un ensayo no escribe).
 */
function bloqueoDeEnsayo(req: Request, ambito: AmbitoCerebro): Response | null {
  if (!ambito.ensayo) return null;
  let ruta = "";
  try {
    ruta = new URL(req.url).pathname;
  } catch {
    ruta = "";
  }
  return rutaPermitidaEnEnsayo(ruta, req.method.toUpperCase())
    ? null
    : apiError(403, "ensayo_solo_lectura", "Un ensayo solo puede pensar y consultar huecos");
}

function nombreDe(req: Request): string {
  try {
    return new URL(req.url).pathname;
  } catch {
    return "?";
  }
}

/*
 * Sobrecargas: el validador de rutas de Next.js 15 exige que el segundo
 * parámetro de una ruta dinámica sea `ctx: C` (NO opcional). Sin contexto,
 * el manejador es `(req) => …`; con `<C>`, `(req, ctx: C) => …`.
 */
export function withBrain(handler: ManejadorSinContexto): (req: Request) => Promise<Response>;
export function withBrain<C>(handler: Manejador<C>): (req: Request, ctx: C) => Promise<Response>;
export function withBrain<C>(handler: Manejador<C>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    const g = await requireBrain(req);
    if (!g.ok) return g.response;
    const bloqueo = bloqueoDeEnsayo(req, g.ambito);
    if (bloqueo) return bloqueo;
    return seguro(nombreDe(req), () => handler(req, g.ambito, ctx));
  };
}

export function withBrainAgenda(handler: ManejadorSinContexto): (req: Request) => Promise<Response>;
export function withBrainAgenda<C>(handler: Manejador<C>): (req: Request, ctx: C) => Promise<Response>;
export function withBrainAgenda<C>(handler: Manejador<C>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    const g = await requireBrainAgenda(req);
    if (!g.ok) return g.response;
    const bloqueo = bloqueoDeEnsayo(req, g.ambito);
    if (bloqueo) return bloqueo;
    return seguro(nombreDe(req), () => handler(req, g.ambito, ctx));
  };
}

/**
 * Auditoría 070 (A-8) — Lee el cuerpo con un tope en BYTES, sin cargar más
 * de la cuenta en memoria. `null` = se pasó.
 */
export async function leerCuerpoAcotado(req: Request, maxBytes: number): Promise<string | null> {
  const declarado = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declarado) && declarado > maxBytes) return null;
  if (!req.body) return "";
  const lector = req.body.getReader();
  const trozos: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await lector.cancel().catch(() => {});
        return null;
      }
      trozos.push(value);
    }
  } finally {
    try {
      lector.releaseLock();
    } catch {
      // Ya liberado al cancelar.
    }
  }
  const todo = new Uint8Array(total);
  let off = 0;
  for (const t of trozos) {
    todo.set(t, off);
    off += t.byteLength;
  }
  return new TextDecoder().decode(todo);
}
