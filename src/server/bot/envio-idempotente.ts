import { and, eq, isNull, lte, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";

/**
 * 071 (D6; T2 de la 067) — Envío idempotente del cerebro con `clientMessageId`.
 *
 * La llave se RESERVA antes de llamar a Meta: se inserta el saliente
 * `pending`, sin `wa_message_id`, y el índice único parcial
 * `message_org_client_msg_uq` (organización, llave) impide que dos peticiones
 * con la misma llave lleguen a Meta. Si el cerebro se cae entre enviar y
 * anotar, su reintento encuentra la llave y no envía otra vez.
 */

type Db = ReturnType<typeof getDb>;

/** Una reserva sin `wa_message_id` más vieja que esto se da por caída (P4). */
export const RESERVA_VIEJA_MS = 2 * 60 * 1000;

export type Reserva =
  | { tipo: "nueva"; messageId: string }
  | { tipo: "reintento"; messageId: string }
  | { tipo: "repetido"; messageId: string }
  | { tipo: "en_curso" };

const YA_SALIO = new Set(["sent", "delivered", "read"]);

export async function reservarEnvio(
  input: {
    organizationId: string;
    conversationId: string;
    clave: string;
    text: string;
    buttons?: { id: string; title: string }[] | null;
  },
  opts: { db?: Db; ahora?: Date } = {},
): Promise<Reserva> {
  const db = opts.db ?? getDb();
  const ahora = opts.ahora ?? new Date();

  const [nueva] = await db
    .insert(schema.message)
    .values({
      id: newId("message"),
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      direction: "out",
      type: "text",
      text: input.text,
      status: "pending",
      aiGenerated: true,
      origin: "ai",
      clientMessageId: input.clave,
      buttons: input.buttons?.length ? input.buttons : null,
      createdAt: ahora,
    })
    .onConflictDoNothing()
    .returning({ id: schema.message.id });
  if (nueva) return { tipo: "nueva", messageId: nueva.id };

  const delNegocio = and(
    eq(schema.message.organizationId, input.organizationId),
    eq(schema.message.clientMessageId, input.clave),
  );
  const [previo] = await db
    .select({
      id: schema.message.id,
      status: schema.message.status,
      waMessageId: schema.message.waMessageId,
      createdAt: schema.message.createdAt,
    })
    .from(schema.message)
    .where(delNegocio)
    .limit(1);
  // Lo tomó otro índice (un `wa_message_id` repetido no puede pasar aquí): por si acaso.
  if (!previo) return { tipo: "en_curso" };

  if (
    previo.status !== "failed" &&
    (previo.waMessageId || YA_SALIO.has(previo.status))
  ) {
    return { tipo: "repetido", messageId: previo.id };
  }
  const vieja = new Date(ahora.getTime() - RESERVA_VIEJA_MS);
  if (previo.status === "pending" && previo.createdAt > vieja)
    return { tipo: "en_curso" };

  // Fallido, o una reserva que quedó a medias: se reserva otra vez, solo si
  // nadie la tomó entretanto.
  const [retomada] = await db
    .update(schema.message)
    .set({ status: "pending", error: null, createdAt: ahora })
    .where(
      and(
        delNegocio,
        or(
          eq(schema.message.status, "failed"),
          and(
            eq(schema.message.status, "pending"),
            isNull(schema.message.waMessageId),
            lte(schema.message.createdAt, vieja),
          ),
        ),
      ),
    )
    .returning({ id: schema.message.id });
  return retomada
    ? { tipo: "reintento", messageId: retomada.id }
    : { tipo: "en_curso" };
}

/** Meta rechazó el envío reservado: queda `failed`, visible en el hilo y reintentable. */
export async function marcarReservaFallida(
  organizationId: string,
  messageId: string,
  error: string,
  db: Db = getDb(),
): Promise<void> {
  await db
    .update(schema.message)
    .set({ status: "failed", error })
    .where(
      and(
        eq(schema.message.organizationId, organizationId),
        eq(schema.message.id, messageId),
      ),
    );
}
