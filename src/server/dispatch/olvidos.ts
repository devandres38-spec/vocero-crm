import { and, asc, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { leerConfigDespacho } from "@/server/brains/config";
import type { EventoOlvido } from "@/server/brains/contract";
import { avisarOlvido, type ResultadoOlvido } from "@/server/brains/deliver";

/**
 * 070 (D7) — El aviso de `conversation.deleted` ya no se pierde si el cerebro
 * está caído (revoca la D12 de la 067).
 *
 * Cada aviso entra a `olvido_pendiente` ANTES de mandarse. Si el cerebro lo
 * confirma, la fila se borra; si no, el worker del despacho lo reintenta
 * (`reintentarOlvidos`, al final de cada `tanda`): 1 min, 5 min, 30 min y
 * después cada hora, hasta 7 días; entonces queda `agotado` con un aviso en el
 * log, solo con ids. Siempre el mismo `eventId`: el cerebro deduplica.
 */

type Db = ReturnType<typeof getDb>;

/** Por cuántas esperas base se multiplica cada intento (1 min, 5, 30, 60…). */
const MULTIPLOS = [1, 5, 30, 60] as const;
export const PLAZO_OLVIDO_MS = 7 * 24 * 60 * 60 * 1000;
const LEASE_MS = 30_000;
const POR_PASADA = 5;

/** La espera base: 1 min. El arnés E2E la baja con `OLVIDO_REINTENTO_MS`. */
function esperaBase(): number {
  const n = Number(process.env.OLVIDO_REINTENTO_MS);
  return Number.isFinite(n) && n > 0 ? n : 60_000;
}

/** La espera después del intento número `intentos` (1, 2, 3, 4+). */
export function esperaTras(
  intentos: number,
  base: number = esperaBase(),
): number {
  const i = Math.min(Math.max(intentos, 1), MULTIPLOS.length) - 1;
  return MULTIPLOS[i]! * base;
}

/**
 * Avisa del olvido con red: anota primero, avisa, y deja la fila para el
 * worker si el cerebro no confirmó. Sin despacho configurado no hay a quién
 * avisar (`no_aplica`) y no se anota nada.
 */
export async function avisarOlvidoConRed(
  evento: EventoOlvido,
  opts: { db?: Db; avisar?: typeof avisarOlvido; ahora?: Date } = {},
): Promise<ResultadoOlvido> {
  if (!leerConfigDespacho().active) return "no_aplica";
  const db = opts.db ?? getDb();
  const ahora = opts.ahora ?? new Date();
  await db
    .insert(schema.olvidoPendiente)
    .values({
      id: evento.eventId,
      organizationId: evento.organization.id,
      conversationId: evento.conversation.id,
      evento,
      // El worker no la toca mientras este intento está en curso.
      leasedUntil: new Date(ahora.getTime() + LEASE_MS),
    })
    .onConflictDoNothing();
  const aviso = await (opts.avisar ?? avisarOlvido)(evento);
  await resolver(db, evento.eventId, aviso, 1, ahora, ahora);
  return aviso;
}

async function resolver(
  db: Db,
  id: string,
  aviso: ResultadoOlvido,
  intentos: number,
  creado: Date,
  ahora: Date,
): Promise<void> {
  if (aviso === "avisado") {
    await db
      .delete(schema.olvidoPendiente)
      .where(eq(schema.olvidoPendiente.id, id));
    return;
  }
  if (ahora.getTime() - creado.getTime() >= PLAZO_OLVIDO_MS) {
    await db
      .update(schema.olvidoPendiente)
      .set({
        status: "agotado",
        attempts: intentos,
        leasedUntil: null,
        updatedAt: ahora,
      })
      .where(eq(schema.olvidoPendiente.id, id));
    console.warn(
      `[olvido] el cerebro no confirmó el olvido ${id} en 7 días: queda agotado`,
    );
    return;
  }
  await db
    .update(schema.olvidoPendiente)
    .set({
      attempts: intentos,
      notBefore: new Date(ahora.getTime() + esperaTras(intentos)),
      leasedUntil: null,
      updatedAt: ahora,
    })
    .where(eq(schema.olvidoPendiente.id, id));
}

/** Una pasada del worker: reintenta los olvidos vencidos. Devuelve cuántos tomó. */
export async function reintentarOlvidos(
  ahora: Date = new Date(),
  opts: { db?: Db; avisar?: typeof avisarOlvido } = {},
): Promise<number> {
  const db = opts.db ?? getDb();
  const tomadas = await db.transaction(async (tx) => {
    const vencidas = await tx
      .select({ id: schema.olvidoPendiente.id })
      .from(schema.olvidoPendiente)
      .where(
        and(
          eq(schema.olvidoPendiente.status, "pendiente"),
          lte(schema.olvidoPendiente.notBefore, ahora),
          or(
            isNull(schema.olvidoPendiente.leasedUntil),
            lt(schema.olvidoPendiente.leasedUntil, ahora),
          ),
        ),
      )
      .orderBy(asc(schema.olvidoPendiente.notBefore))
      .limit(POR_PASADA)
      .for("update", { skipLocked: true });
    if (vencidas.length === 0) return [];
    return tx
      .update(schema.olvidoPendiente)
      .set({
        leasedUntil: new Date(ahora.getTime() + LEASE_MS),
        updatedAt: ahora,
      })
      .where(
        inArray(
          schema.olvidoPendiente.id,
          vencidas.map((v) => v.id),
        ),
      )
      .returning();
  });

  for (const fila of tomadas) {
    const aviso = await (opts.avisar ?? avisarOlvido)(
      fila.evento as EventoOlvido,
    );
    await resolver(
      db,
      fila.id,
      aviso,
      fila.attempts + 1,
      fila.createdAt,
      ahora,
    );
  }
  return tomadas.length;
}
