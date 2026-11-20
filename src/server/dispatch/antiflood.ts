import { and, eq, gt, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { LimitesBot } from "@/lib/ajustes-bot";

/**
 * 073-B (D4, P-9; decisión #5) — Tope anti-flood del despacho.
 *
 * Cada despacho es un turno del cerebro, y en plataforma cada turno lo paga
 * la llave del negocio (BYOK): un bot de spam o un cliente en bucle podía
 * vaciarle el saldo en una tarde. Se cuenta en la tabla `dispatch` —no en
 * memoria—, así que vale con varias réplicas y sobrevive a un redeploy.
 *
 * No se cuentan los `descartado` (nunca llegaron al cerebro).
 */

export type Alcance = "conversacion_hora" | "conversacion_dia" | "organizacion_dia";

export type Exceso = { alcance: Alcance; tope: number; usados: number };

export type Conteo = { conversacionHora: number; conversacionDia: number; organizacionDia: number };

/** Pura: el primer tope que se alcanzó (el más estrecho primero), o null. */
export function topeAlcanzado(conteo: Conteo, limites: LimitesBot): Exceso | null {
  if (conteo.conversacionHora >= limites.perConversationHour) {
    return { alcance: "conversacion_hora", tope: limites.perConversationHour, usados: conteo.conversacionHora };
  }
  if (conteo.conversacionDia >= limites.perConversationDay) {
    return { alcance: "conversacion_dia", tope: limites.perConversationDay, usados: conteo.conversacionDia };
  }
  if (conteo.organizacionDia >= limites.perOrganizationDay) {
    return { alcance: "organizacion_dia", tope: limites.perOrganizationDay, usados: conteo.organizacionDia };
  }
  return null;
}

/** Una consulta: los tres conteos de las últimas 24 h del negocio. */
export async function contarDespachos(
  organizationId: string,
  conversationId: string,
  ahora: Date = new Date()
): Promise<Conteo> {
  const d = schema.dispatch;
  const hora = new Date(ahora.getTime() - 60 * 60 * 1000).toISOString();
  const dia = new Date(ahora.getTime() - 24 * 60 * 60 * 1000);
  const [fila] = await getDb()
    .select({
      conversacionHora: sql<number>`count(*) filter (where ${d.conversationId} = ${conversationId} and ${d.createdAt} > ${hora}::timestamp)`,
      conversacionDia: sql<number>`count(*) filter (where ${d.conversationId} = ${conversationId})`,
      organizacionDia: sql<number>`count(*)`,
    })
    .from(d)
    .where(and(eq(d.organizationId, organizationId), gt(d.createdAt, dia), ne(d.status, "descartado")));
  return {
    conversacionHora: Number(fila?.conversacionHora ?? 0),
    conversacionDia: Number(fila?.conversacionDia ?? 0),
    organizacionDia: Number(fila?.organizacionDia ?? 0),
  };
}
