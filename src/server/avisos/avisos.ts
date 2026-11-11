import { and, asc, count, eq, isNotNull, isNull, lte, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { avisosEncendidos, configTelegram } from "./flag";
import { AvisoError, enviarTelegram } from "./telegram";
import { avisoDeSeguimiento, avisoDeTraspaso } from "./textos";

/**
 * 071 (3.10, D7) — Avisos de traspaso por Telegram, adaptados de
 * `aliantis-core/src/notify/notify-handoffs.ts`:
 *
 * - cada traspaso nuevo (`handoff_at`) deja una fila `pendiente` en
 *   `aviso_traspaso`, salvo `manual_reply` (el negocio ya contestó desde su
 *   teléfono, P2) y las conversaciones del Laboratorio;
 * - el worker del despacho las envía (`enviarAvisosPendientes`); un fallo
 *   pasajero se reintenta hasta 60 minutos, uno de token o de grupo pasa a
 *   `fallido` de inmediato;
 * - si la persona vuelve a escribir con el traspaso abierto, un seguimiento,
 *   como mucho uno cada 30 minutos por traspaso.
 *
 * Ningún texto ni log lleva datos del paciente ni el token.
 */

type Db = ReturnType<typeof getDb>;

export const SEGUIMIENTO_CADA_MIN = 30;
export const RENDIRSE_A_LOS_MIN = 60;
const POR_PASADA = 10;
const minutosAntes = (ahora: Date, min: number) =>
  new Date(ahora.getTime() - min * 60_000);

/** Al traspasar: anota el aviso pendiente. Nunca lanza: el traspaso ya ocurrió. */
export async function registrarTraspaso(
  datos: {
    organizationId: string;
    conversationId: string;
    handoffAt: Date;
    reason: string;
    esPrueba?: boolean;
  },
  opts: { db?: Db; env?: NodeJS.ProcessEnv } = {},
): Promise<void> {
  if (!avisosEncendidos(opts.env)) return;
  if (datos.reason === "manual_reply" || datos.esPrueba) return;
  try {
    await (opts.db ?? getDb())
      .insert(schema.avisoTraspaso)
      .values({
        id: newId("avisoTraspaso"),
        organizationId: datos.organizationId,
        conversationId: datos.conversationId,
        handoffAt: datos.handoffAt,
        reason: datos.reason,
      })
      .onConflictDoNothing();
  } catch (err) {
    console.error(
      "[avisos] no se pudo anotar el aviso del traspaso:",
      err instanceof Error ? err.message : "error desconocido",
    );
  }
}

type Destino = { negocio: string; base: string; token: string; chatId: string };

/** El grupo y el nombre del negocio, o por qué no se puede avisar. */
async function destinoDe(
  db: Db,
  organizationId: string,
  env?: NodeJS.ProcessEnv,
): Promise<Destino | "sin_token" | "sin_grupo"> {
  const { token, base } = configTelegram(env);
  if (!token) return "sin_token";
  const [fila] = await db
    .select({
      chatId: schema.avisoCanal.telegramChatId,
      negocio: schema.organization.name,
    })
    .from(schema.avisoCanal)
    .innerJoin(
      schema.organization,
      eq(schema.organization.id, schema.avisoCanal.organizationId),
    )
    .where(eq(schema.avisoCanal.organizationId, organizationId))
    .limit(1);
  if (!fila) return "sin_grupo";
  return { negocio: fila.negocio, base, token, chatId: fila.chatId };
}

/** Una pasada del worker: envía los avisos pendientes. Devuelve cuántos salieron. */
export async function enviarAvisosPendientes(
  ahora: Date = new Date(),
  opts: { db?: Db; env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {},
): Promise<number> {
  if (!avisosEncendidos(opts.env)) return 0;
  const db = opts.db ?? getDb();
  const pendientes = await db
    .select()
    .from(schema.avisoTraspaso)
    .where(eq(schema.avisoTraspaso.status, "pendiente"))
    .orderBy(asc(schema.avisoTraspaso.createdAt))
    .limit(POR_PASADA);

  let enviados = 0;
  for (const aviso of pendientes) {
    const marcar = (status: "enviado" | "fallido" | "omitido" | "pendiente") =>
      db
        .update(schema.avisoTraspaso)
        .set({
          status,
          attempts: aviso.attempts + 1,
          ...(status === "enviado" ? { notifiedAt: ahora } : {}),
          updatedAt: ahora,
        })
        .where(
          and(
            eq(schema.avisoTraspaso.id, aviso.id),
            eq(schema.avisoTraspaso.status, "pendiente"),
          ),
        );

    const destino = await destinoDe(db, aviso.organizationId, opts.env);
    if (destino === "sin_token" || destino === "sin_grupo") {
      await marcar("omitido");
      console.warn(
        destino === "sin_token"
          ? `[avisos] AVISOS encendido sin TELEGRAM_BOT_TOKEN: aviso ${aviso.id} omitido`
          : `[avisos] el negocio ${aviso.organizationId} no tiene grupo registrado (pnpm avisos:grupo): aviso ${aviso.id} omitido`,
      );
      continue;
    }
    const [cuenta] = await db
      .select({ abiertos: count() })
      .from(schema.conversation)
      .where(
        and(
          eq(schema.conversation.organizationId, aviso.organizationId),
          isNotNull(schema.conversation.handoffAt),
          eq(schema.conversation.isTest, false),
        ),
      );
    try {
      await enviarTelegram(
        destino,
        avisoDeTraspaso({
          negocio: destino.negocio,
          motivo: aviso.reason,
          conversationId: aviso.conversationId,
          abiertos: Math.max(1, Number(cuenta?.abiertos ?? 1)),
        }),
        opts.fetchImpl,
      );
      await marcar("enviado");
      enviados++;
    } catch (err) {
      const fallo =
        err instanceof AvisoError ? err : new AvisoError("pasajero", 0);
      const rendirse =
        !fallo.reintentable ||
        aviso.createdAt <= minutosAntes(ahora, RENDIRSE_A_LOS_MIN);
      await marcar(rendirse ? "fallido" : "pendiente");
      // Solo ids y qué revisar: nunca el token, la URL ni el texto.
      console.error(
        `[avisos] aviso ${aviso.id}: ${fallo.message} (HTTP ${fallo.status})`,
      );
    }
  }
  return enviados;
}

/**
 * La persona volvió a escribir con el traspaso abierto: un seguimiento, como
 * mucho uno cada 30 minutos por traspaso. Nunca lanza.
 */
export async function avisarSeguimiento(
  datos: { organizationId: string; conversationId: string; handoffAt: Date },
  opts: {
    db?: Db;
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
    ahora?: Date;
  } = {},
): Promise<boolean> {
  if (!avisosEncendidos(opts.env)) return false;
  const db = opts.db ?? getDb();
  const ahora = opts.ahora ?? new Date();
  try {
    // El freno: se reclama el seguimiento con un update condicional.
    const [reclamado] = await db
      .update(schema.avisoTraspaso)
      .set({ lastFollowupAt: ahora, updatedAt: ahora })
      .where(
        and(
          eq(schema.avisoTraspaso.organizationId, datos.organizationId),
          eq(schema.avisoTraspaso.conversationId, datos.conversationId),
          eq(schema.avisoTraspaso.handoffAt, datos.handoffAt),
          eq(schema.avisoTraspaso.status, "enviado"),
          or(
            isNull(schema.avisoTraspaso.lastFollowupAt),
            lte(
              schema.avisoTraspaso.lastFollowupAt,
              minutosAntes(ahora, SEGUIMIENTO_CADA_MIN),
            ),
          ),
        ),
      )
      .returning({ id: schema.avisoTraspaso.id });
    if (!reclamado) return false;
    const destino = await destinoDe(db, datos.organizationId, opts.env);
    if (typeof destino === "string") return false;
    await enviarTelegram(
      destino,
      avisoDeSeguimiento({
        negocio: destino.negocio,
        conversationId: datos.conversationId,
      }),
      opts.fetchImpl,
    );
    return true;
  } catch (err) {
    console.error(
      `[avisos] seguimiento de ${datos.conversationId}: ${
        err instanceof AvisoError ? err.message : "error desconocido"
      }`,
    );
    return false;
  }
}
