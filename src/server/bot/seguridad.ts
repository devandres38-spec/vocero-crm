import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

/**
 * 071 (3.8, D3; D8 de la 067, D9 de Aliantis) — Salud con el bot pausado.
 *
 * Con el Agente apagado, lo marcado con salud se despacha igual, y el cerebro
 * solo puede contestar UN mensaje de seguridad por cada entrante de salud.
 */

type Db = ReturnType<typeof getDb>;

/** El interruptor de la pantalla Agente. Sin perfil, apagado. */
export async function agenteEncendido(organizationId: string, db: Db = getDb()): Promise<boolean> {
  const [perfil] = await db
    .select({ enabled: schema.agentProfile.enabled })
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  return perfil?.enabled === true;
}

/**
 * ¿Hay un entrante con la marca `salud` posterior al último saliente del
 * agente? Es lo que autoriza un mensaje de seguridad: después de contestarlo,
 * ese saliente es el último y la respuesta siguiente ya no pasa.
 */
export async function saludSinRespuesta(
  organizationId: string,
  conversationId: string,
  db: Db = getDb()
): Promise<boolean> {
  const delHilo = scoped(
    schema.message.organizationId,
    organizationId,
    eq(schema.message.conversationId, conversationId)
  );
  const [ultimoDelAgente] = await db
    .select({ createdAt: schema.message.createdAt })
    .from(schema.message)
    .where(and(delHilo, eq(schema.message.direction, "out"), eq(schema.message.aiGenerated, true)))
    .orderBy(desc(schema.message.createdAt))
    .limit(1);
  const [salud] = await db
    .select({ id: schema.message.id })
    .from(schema.message)
    .where(
      and(
        delHilo,
        eq(schema.message.direction, "in"),
        sql`'salud' = any(${schema.message.privacyFlags})`,
        ultimoDelAgente
          ? sql`${schema.message.createdAt} > ${ultimoDelAgente.createdAt}`
          : undefined
      )
    )
    .limit(1);
  return Boolean(salud);
}
