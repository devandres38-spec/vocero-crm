import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { esPlataforma } from "@/lib/tenancy";
import { estadoIaDe } from "@/lib/ai/provider";
import { cuboHora, registrarIncidente } from "@/server/incidentes";
import { organizacionSuspendida } from "@/server/platform/estado";
import { encolarDespacho } from "@/server/dispatch/outbox";
import { iniciarWorker, programarTanda } from "@/server/dispatch/worker";

/**
 * 021 — El enganche de la ingesta: un mensaje entrante real ya está en la
 * bandeja y hay un cerebro configurado, así que su turno se ENCOLA.
 *
 * 036 — Desde que el CRM no trae agente, este es el único camino por el que
 * alguien contesta, y el interruptor de la pantalla Agente
 * (`agent_profile.enabled`) decide si se toma: apagado, la conversación
 * queda en la bandeja para una persona.
 *
 * Nunca lanza. Corre al final de la ingesta, dentro del `after()` del webhook:
 * una excepción aquí no puede costarle a ese payload los mensajes que vengan
 * detrás. Lo que no se encoló sigue en la bandeja.
 */
export async function despacharAlCerebro(
  conversationId: string,
  organizationId: string,
  messageId: string
): Promise<void> {
  try {
    const [conv] = await getDb()
      .select({
        aiEnabled: schema.conversation.aiEnabled,
        handoffAt: schema.conversation.handoffAt,
        isTest: schema.conversation.isTest,
      })
      .from(schema.conversation)
      .where(
        and(
          eq(schema.conversation.id, conversationId),
          eq(schema.conversation.organizationId, organizationId)
        )
      )
      .limit(1);
    if (!conv) return;

    // Pausada por una persona o traspasada por el agente: no se despacha. Es
    // la misma bandera que respeta `/api/bot/messages`, y aquí la respeta
    // cualquier cerebro sin tener que acordarse. El Laboratorio no pasa por la
    // ingesta, pero una conversación de prueba no sale del CRM por ningún
    // camino.
    if (!conv.aiEnabled || conv.handoffAt || conv.isTest) return;

    const [perfil] = await getDb()
      .select({ enabled: schema.agentProfile.enabled })
      .from(schema.agentProfile)
      .where(eq(schema.agentProfile.organizationId, organizationId))
      .limit(1);
    if (!perfil?.enabled) return;
    // 069 — Una organización suspendida guarda lo que entra pero no despacha.
    if (esPlataforma() && (await organizacionSuspendida(organizationId))) return;
    // 073-A (punto ciego n.º 1) — Sin llave de IA utilizable no se despacha.
    if (esPlataforma() && !(await iaUtilizable(organizationId))) return;

    // 025 — El despacho anota qué entrante lo provoca: es lo que le debe al
    // cerebro, aunque después la conversación tenga una respuesta.
    const { notBefore } = await encolarDespacho({
      organizationId,
      conversationId,
      messageIds: [messageId],
    });
    iniciarWorker();
    // Que despierte justo cuando la ventana venza, no en su siguiente barrido.
    programarTanda(notBefore);
  } catch (err) {
    console.error("[despacho] no se pudo encolar el turno:", err);
  }
}

/**
 * 073-A (punto ciego n.º 1) — ¿Puede pensar el cerebro de este negocio?
 *
 * En plataforma el cerebro piensa SOLO con la llave del negocio
 * (`/api/brains/llm`, `soloOrganizacion`). Con la llave pausada (el
 * proveedor dijo 402 sin saldo o 401) o sin configurar, despachar era peor
 * que no hacerlo: cada mensaje entrante despertaba a Nea, el proxy contestaba
 * 402 y la conversación terminaba en handoff con un motivo falso —la bandeja
 * se llenaba de «Atención humana» por una sola causa—.
 *
 * Ahora el mensaje queda en la bandeja como cualquier otro sin despacho, y
 * queda UN incidente por hora (`sin_saldo` o `sin_credencial`) para el dueño.
 * En `single` no aplica: Nea puede tener su propia llave (`LLM_API_KEY`).
 */
async function iaUtilizable(organizationId: string): Promise<boolean> {
  // Sin descifrar la llave: solo su estado (en plataforma el entorno no cuenta).
  const estado = await estadoIaDe(organizationId);
  if (estado.activa) return true;
  const kind = estado.motivo === "sin_configurar" ? "sin_credencial" : "sin_saldo";
  await registrarIncidente({
    organizationId,
    kind,
    detail:
      kind === "sin_saldo"
        ? "La llave de IA está pausada (sin saldo o rechazada): los mensajes no se le despachan al agente."
        : "No hay llave de IA configurada: los mensajes no se le despachan al agente.",
    dedupeKey: `${kind}:${cuboHora()}`,
  });
  return false;
}
