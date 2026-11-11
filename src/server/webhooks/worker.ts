import { conNegocio, trabajoDeFondo } from "@/lib/db/contexto";
import { eventosPendientes, negociosConEventosViejos } from "@/server/db-sistema";
import {
  cortesDePurga,
  marcarProcesado,
  purgar,
  reintentarOAgotar,
  tomarEvento,
  type FilaEvento,
} from "./eventos";
import { procesarFuente } from "./procesar";
import { aplicarRetencion, RETENCION_CADA_MS } from "@/server/retencion/aplicar";

/**
 * 047 — El barrido de los eventos de webhook.
 *
 * Corre siempre (la ingesta es del núcleo, no depende del cerebro ni de una
 * bandera), dentro del proceso como el worker del despacho. Lo que lo hace
 * fiable es la tabla: un evento que falló espera su hora como `pendiente`, y
 * uno que se estaba procesando cuando murió el proceso tiene una reserva que
 * vence y vuelve al barrido.
 */

const INTERVALO_MS = 10_000;
const POR_TANDA = 20;
const PURGA_CADA_MS = 3_600_000;

type Estado = {
  timer: NodeJS.Timeout | null;
  corriendo: boolean;
  cita: NodeJS.Timeout | null;
  citaEn: number | null;
  ultimaPurga: number;
  /** 072 — La última pasada de retención (0: todavía no, corre en el primer barrido). */
  ultimaRetencion: number;
};

// En globalThis: en dev los módulos se evalúan más de una vez y todas las
// copias deben compartir un solo barrido.
const g = globalThis as unknown as { __voceroWebhookBarrido?: Estado };

function estado(): Estado {
  if (!g.__voceroWebhookBarrido) {
    g.__voceroWebhookBarrido = {
      timer: null,
      corriendo: false,
      cita: null,
      citaEn: null,
      ultimaPurga: 0,
      ultimaRetencion: 0,
    };
  }
  return g.__voceroWebhookBarrido;
}

export function iniciarBarrido(): void {
  const e = estado();
  if (e.timer) return;
  e.timer = setInterval(() => void barrido(), INTERVALO_MS);
  e.timer.unref?.();
}

export function detenerBarrido(): void {
  const e = estado();
  if (e.timer) clearInterval(e.timer);
  e.timer = null;
  if (e.cita) clearTimeout(e.cita);
  e.cita = null;
  e.citaEn = null;
}

/**
 * Despierta al barrido a la hora del siguiente intento, además del intervalo:
 * un reintento a los 30 s no debería esperar hasta 10 s más.
 */
export function programarBarrido(cuando: Date): void {
  const e = estado();
  const objetivo = cuando.getTime() + 50;
  if (e.citaEn !== null && e.citaEn <= objetivo && e.citaEn > Date.now()) return;
  if (e.cita) clearTimeout(e.cita);
  e.citaEn = objetivo;
  e.cita = setTimeout(() => {
    e.cita = null;
    e.citaEn = null;
    void barrido();
  }, Math.max(0, objetivo - Date.now()));
  e.cita.unref?.();
}

/** Procesa el evento que la ruta acaba de guardar. Nunca lanza. */
export async function procesarEvento(id: string, organizationId: string): Promise<void> {
  try {
    // 075 — De fondo (corre después de responder) y dentro de su negocio.
    await trabajoDeFondo("webhooks", () =>
      conNegocio(organizationId, async () => {
        const fila = await tomarEvento(id);
        if (fila) await intentar(fila);
      })
    );
  } catch (err) {
    // La base falló al reclamar: el evento sigue pendiente y lo toma el barrido.
    console.error(`[webhooks] no se pudo procesar ${id} ahora; queda para el barrido:`, mensaje(err));
  }
}

/** Una pasada. Devuelve cuántos eventos tomó. Nunca lanza. */
export async function barrido(ahora: Date = new Date()): Promise<number> {
  const e = estado();
  if (e.corriendo) return 0;
  e.corriendo = true;
  try {
    return await trabajoDeFondo("webhooks", () => pasada(e, ahora));
  } catch (err) {
    console.error("[webhooks] el barrido falló:", mensaje(err));
    return 0;
  } finally {
    e.corriendo = false;
  }
}

/**
 * 075 — El trabajo pendiente sale de `vocero_eventos_pendientes` (id y
 * negocio, entre todos) y cada evento se toma y procesa DENTRO de su negocio.
 */
async function pasada(e: ReturnType<typeof estado>, ahora: Date): Promise<number> {
  const pendientes = await eventosPendientes(ahora, POR_TANDA);
  let tomados = 0;
  for (const { id, organizationId } of pendientes) {
    await conNegocio(organizationId, async () => {
      const fila = await tomarEvento(id, ahora);
      if (!fila) return;
      tomados++;
      await intentar(fila);
    });
  }
  if (ahora.getTime() - e.ultimaPurga >= PURGA_CADA_MS) {
    e.ultimaPurga = ahora.getTime();
    let borrados = 0;
    const cortes = cortesDePurga(ahora);
    for (const org of await negociosConEventosViejos(cortes.procesado, cortes.agotado)) {
      borrados += await conNegocio(org, () => purgar(ahora));
    }
    if (borrados > 0) console.log(`[webhooks] ${borrados} evento(s) viejo(s) borrado(s)`);
  }
  // 072 — La retención por negocio, una vez al día. Corre aparte (sin
  // await): una pasada larga no frena los webhooks. Nunca lanza.
  if (ahora.getTime() - (e.ultimaRetencion ?? 0) >= RETENCION_CADA_MS) {
    e.ultimaRetencion = ahora.getTime();
    void aplicarRetencion(ahora).catch((err) =>
      console.error("[retencion] la pasada falló:", mensaje(err))
    );
  }
  return tomados;
}

async function intentar(fila: FilaEvento): Promise<void> {
  try {
    await procesarFuente(fila.fuente, fila.payload);
  } catch (err) {
    const cuando = await reintentarOAgotar(fila, err);
    if (cuando) {
      console.warn(
        `[webhooks] ${fila.id} falló (intento ${fila.attempts}); se reintenta a las ${cuando.toISOString()}: ${mensaje(err)}`
      );
      programarBarrido(cuando);
    } else {
      console.error(
        `[webhooks] ${fila.id} agotado tras ${fila.attempts} intentos: ${mensaje(err)}. Se puede reintentar en Configuración → WhatsApp.`
      );
    }
    return;
  }
  await marcarProcesado(fila);
}

function mensaje(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
