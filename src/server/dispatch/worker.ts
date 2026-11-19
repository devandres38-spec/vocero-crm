import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { destinoDe } from "@/server/brains/destino";
import { verificarDestino } from "@/server/brains/red";
import { esPlataforma } from "@/lib/tenancy";
import {
  construirEvento,
  entregar,
  rafagaDe,
  sinDespachar,
} from "@/server/brains/deliver";
import {
  anotarDespliegue,
  caducarAHumano,
  descartarDespacho,
  encolarDespacho,
  marcarEntregado,
  mensajesAnotados,
  pasarAHumano,
  reintentarOCaducar,
  renovarLease,
  tomarPendientes,
  type FilaDespacho,
} from "@/server/dispatch/outbox";

/**
 * 021 — El worker del despachador.
 *
 * Dentro del proceso, como el resto del trabajo de fondo del repo (sin colas
 * externas: constitución II). Lo que lo hace fiable no es el proceso sino el
 * outbox: si muere a mitad, el lease expira y el siguiente barrido lo retoma;
 * si el contenedor se reinicia, los pendientes siguen ahí y el arranque los
 * reanuda (`instrumentation-node.ts`).
 *
 * Puerto de `src/server/dispatch/worker.ts` de Vocero Cloud.
 */

/**
 * El barrido de fondo. No es lo que dispara el caso normal —para eso está
 * `programarTanda`— sino la red: filas en espera tras un fallo, las que
 * encoló otro proceso y las que quedaron de antes de un reinicio.
 */
const INTERVALO_MS = 2000;
const POR_TANDA = 10;
/**
 * Margen sobre la hora de la cita. `tomarPendientes` filtra por
 * `not_before <= ahora`: despertar clavado en el borde puede llegar un
 * milisegundo antes, no ver la fila y dejársela al barrido.
 */
const MARGEN_MS = 50;
/** Cada cuánto se renueva el lease mientras se espera al cerebro. */
const LATIDO_MS = 20_000;

type Estado = {
  timer: NodeJS.Timeout | null;
  corriendo: boolean;
  // La próxima cita y su hora. Se guarda la hora para no pisar una cita más
  // próxima con otra más lejana: encolar en dos conversaciones a la vez
  // dejaría a la primera esperando a la segunda.
  cita: NodeJS.Timeout | null;
  citaEn: number | null;
};

// En globalThis porque en dev los módulos se evalúan más de una vez (una por
// ruta) y todas las copias deben compartir el mismo worker: dos temporizadores
// sobre el mismo outbox se pisarían el lease.
const globalForWorker = globalThis as unknown as {
  __voceroDispatchWorker?: Estado;
};

function estado(): Estado {
  if (!globalForWorker.__voceroDispatchWorker) {
    globalForWorker.__voceroDispatchWorker = {
      timer: null,
      corriendo: false,
      cita: null,
      citaEn: null,
    };
  }
  return globalForWorker.__voceroDispatchWorker;
}

export function iniciarWorker(): void {
  const e = estado();
  if (e.timer) return;
  e.timer = setInterval(() => void tanda(), INTERVALO_MS);
  // `unref` para que el temporizador no impida que el proceso termine.
  e.timer.unref?.();
}

/**
 * Despierta al worker cuando venza esta ventana, además del barrido.
 *
 * La ventana de agrupado existe por una razón (la gente escribe a trozos),
 * pero los hasta 2 s de después eran solo el worker sin enterarse.
 *
 * Una sola cita, la más próxima. Las demás filas que venzan entretanto las
 * recoge esa misma tanda, porque toma TODAS las vencidas, no solo la suya.
 */
export function programarTanda(cuando: Date): void {
  const e = estado();
  const objetivo = cuando.getTime() + MARGEN_MS;
  if (e.citaEn !== null && e.citaEn <= objetivo) return;
  if (e.cita) clearTimeout(e.cita);
  e.citaEn = objetivo;
  e.cita = setTimeout(() => {
    e.cita = null;
    e.citaEn = null;
    void tanda();
  }, Math.max(0, objetivo - Date.now()));
  e.cita.unref?.();
}

export function detenerWorker(): void {
  const e = estado();
  if (e.timer) clearInterval(e.timer);
  e.timer = null;
  if (e.cita) clearTimeout(e.cita);
  e.cita = null;
  e.citaEn = null;
}

/** Una pasada. Devuelve cuántos despachos tomó. */
export async function tanda(ahora: Date = new Date()): Promise<number> {
  const e = estado();
  if (e.corriendo) return 0;
  e.corriendo = true;
  try {
    let count = 0;
    for (; count < POR_TANDA; count++) {
      // De una en una, y con la hora de AHORA: las que esperan en la cola no
      // envejecen detrás de un POST lento con el lease ya corriendo.
      const [fila] = await tomarPendientes(1, count === 0 ? ahora : new Date());
      if (!fila) break;
      const latido = setInterval(() => {
        void renovarLease(fila).catch(() =>
          console.error("[despacho] no se pudo renovar el lease")
        );
      }, LATIDO_MS);
      latido.unref?.();
      try {
        await procesar(fila);
      } finally {
        clearInterval(latido);
      }
    }
    return count;
  } catch (err) {
    console.error("[despacho] la tanda falló:", err);
    return 0;
  } finally {
    e.corriendo = false;
  }
}

/**
 * 070 — Cuánto vive un despacho en `multi` (`expiresAt`): pasado ese tiempo el
 * cerebro ya no contesta y pasa la conversación a una persona. Cubre la
 * ventana de agrupado, los reintentos y la cola del cerebro.
 */
export const VIDA_DESPACHO_MS = 10 * 60 * 1000;

async function procesar(fila: FilaDespacho): Promise<void> {
  // 070 — El destino se resuelve AHORA: en `multi`, el cerebro asignado a
  // esta organización (si se reasignó o se pausó en la espera, manda eso).
  const config = await destinoDe(fila.organizationId);
  if (!config) {
    // Ya no hay a quién entregarlo (se quitó la configuración o, en `multi`,
    // el negocio no tiene cerebro activo): el mensaje queda en la bandeja para
    // una persona.
    await descartarDespacho(fila, "el despacho ya no está configurado");
    return;
  }

  // Auditoría 070 (M-10): en `multi`, un despacho que ya venció (el CRM estuvo
  // caído o el cerebro no lo aceptó a tiempo) no se le manda a Nea con un
  // `expiresAt` en el pasado: pasa a una persona aquí mismo.
  if (esPlataforma() && fila.createdAt.getTime() + VIDA_DESPACHO_MS <= Date.now()) {
    if (await caducarAHumano(fila, "el despacho venció antes de entregarse")) {
      await pasarAHumano(fila.organizationId, fila.conversationId);
    }
    return;
  }

  /**
   * La pausa se vuelve a mirar al ENTREGAR, no solo al encolar.
   *
   * Entre un momento y otro está la ventana de agrupado: si alguien pausa la
   * IA en esos segundos, el turno ya no le corresponde a ningún cerebro.
   */
  const [conv] = await getDb()
    .select({
      aiEnabled: schema.conversation.aiEnabled,
      handoffAt: schema.conversation.handoffAt,
      isTest: schema.conversation.isTest,
    })
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.id, fila.conversationId),
        eq(schema.conversation.organizationId, fila.organizationId)
      )
    )
    .limit(1);
  if (!conv) {
    await descartarDespacho(fila, "la conversación ya no existe");
    return;
  }
  // 033 — Una conversación de prueba SÍ se despacha: la ingesta nunca encola
  // una (`despacharAlCerebro`), así que si hay un despacho suyo lo encoló el
  // Laboratorio. Su respuesta vuelve por `/api/bot/messages`, que la guarda
  // sin enviarla.
  if (!conv.aiEnabled || conv.handoffAt) {
    await descartarDespacho(fila, "la IA se pausó antes de despachar");
    return;
  }

  const evento = await construirEvento(
    fila,
    esPlataforma() ? { expiresAt: new Date(fila.createdAt.getTime() + VIDA_DESPACHO_MS) } : {}
  );
  if (!evento) {
    await descartarDespacho(fila, "la conversación ya no existe");
    return;
  }
  /**
   * 025 — Un despacho sin mensajes no se entrega.
   *
   * Pasa cuando lo que lo provocó ya lo contestó una persona dentro de la
   * ventana. No es una caída del cerebro: mandárselo vacío sería pedirle un
   * turno sobre nada —Nea lo rechaza con 422—, y un 4xx no se reintenta: la
   * conversación acabaría con un humano por un fallo que no existió.
   */
  if (evento.messages.length === 0) {
    await descartarDespacho(fila, "sin mensajes por despachar");
    return;
  }

  if (config.deploymentId) {
    // Auditoría 070 (A-2): justo antes de conectar, el host y sus IPs
    // resueltas (DNS rebinding). Un destino reservado es un error de
    // configuración: a una persona. Un DNS que no resuelve puede ser pasajero.
    const bloqueo = await verificarDestino(config.url);
    if (bloqueo) {
      const detalle = `destino del cerebro no permitido (${bloqueo})`;
      const caduco =
        bloqueo === "no_resuelve"
          ? await reintentarOCaducar(fila, detalle)
          : await caducarAHumano(fila, detalle);
      if (caduco) await pasarAHumano(fila.organizationId, fila.conversationId);
      return;
    }
    // 070 — Qué cerebro recibió este despacho: `/api/brains/messages` rechaza
    // (409 `cerebro_reasignado`) la respuesta de cualquier otro. Solo con el
    // lease todavía nuestro (A-12).
    if (fila.brainDeploymentId !== config.deploymentId && !(await anotarDespliegue(fila, config.deploymentId))) {
      return;
    }
  }
  const resultado = await entregar(evento, config);
  // El lease pudo vencer mientras se esperaba al cerebro y otro pudo retomar
  // la fila: si ya no es nuestra, lo que hagamos aquí pisaría su trabajo.
  if (!(await renovarLease(fila))) return;

  if (resultado.ok) {
    if (!(await marcarEntregado(fila))) return;
    /**
     * 025 — Lo que entró mientras el evento iba en vuelo no viajó en él.
     *
     * El evento se armó antes de que ese mensaje existiera. `encolarDespacho`
     * lo dejó anotado en la fila, así que aquí se relee: lo anotado (y lo que
     * haya en la ráfaga) menos lo que el cerebro recibió es lo que se le sigue
     * debiendo, y sale en otro despacho con esos ids anotados.
     */
    const actual = await rafagaDe(
      fila.organizationId,
      fila.conversationId,
      await mensajesAnotados(fila)
    );
    const pendientes = sinDespachar(
      evento.messages.map((m) => m.id),
      actual
    );
    if (pendientes.length) {
      const { notBefore } = await encolarDespacho({
        organizationId: fila.organizationId,
        conversationId: fila.conversationId,
        messageIds: pendientes,
      });
      programarTanda(notBefore);
    }
    return;
  }

  console.error(
    `[despacho] ${fila.id} (intento ${fila.attempts}): ${resultado.detalle}`
  );
  const caduco = resultado.reintentable
    ? await reintentarOCaducar(fila, resultado.detalle)
    : await caducarAHumano(fila, resultado.detalle);
  if (caduco) await pasarAHumano(fila.organizationId, fila.conversationId);
}
