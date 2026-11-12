import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { encolarDespacho } from "@/server/dispatch/outbox";
import { permitidoPorLista } from "@/server/dispatch/solo-numeros";
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
  messageId: string,
  /** 071 (3.8): el entrante trae la marca `salud`. */
  opciones: { salud?: boolean } = {}
): Promise<void> {
  try {
    const [conv] = await getDb()
      .select({
        aiEnabled: schema.conversation.aiEnabled,
        handoffAt: schema.conversation.handoffAt,
        isTest: schema.conversation.isTest,
        contactId: schema.conversation.contactId,
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
      .select({
        enabled: schema.agentProfile.enabled,
        soloNumerosActivo: schema.agentProfile.soloNumerosActivo,
        soloNumeros: schema.agentProfile.soloNumeros,
      })
      .from(schema.agentProfile)
      .where(eq(schema.agentProfile.organizationId, organizationId))
      .limit(1);
    // 076 (respuesta 2 de Andres) — Un negocio pausado por Andres queda como
    // con el Agente apagado.
    const [negocio] = await getDb()
      .select({ pausadoEn: schema.organization.pausadoEn })
      .from(schema.organization)
      .where(eq(schema.organization.id, organizationId))
      .limit(1);
    const agenteActivo = perfil?.enabled === true && !negocio?.pausadoEn;
    // 071 (3.8, D9 de Aliantis): con el Agente apagado (o el negocio
    // pausado), lo marcado con salud se despacha igual; lo demás queda para
    // una persona. La seguridad del paciente no se pausa.
    if (!agenteActivo && !opciones.salud) return;

    // 079 (5.5) — «Solo estos números» (piloto): fuera de la lista, el
    // mensaje queda en la bandeja para una persona. La misma excepción de
    // salud (D9): lo marcado con salud se despacha igual. El Laboratorio no
    // llega aquí (`isTest` ya salió arriba).
    if (perfil?.soloNumerosActivo === true && !opciones.salud) {
      const [contacto] = await getDb()
        .select({ waIdentity: schema.contact.waIdentity })
        .from(schema.contact)
        .where(
          and(
            eq(schema.contact.id, conv.contactId),
            eq(schema.contact.organizationId, organizationId)
          )
        )
        .limit(1);
      const lista = { activo: true, numeros: perfil.soloNumeros ?? [] };
      if (!permitidoPorLista(lista, contacto?.waIdentity)) return;
    }

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
