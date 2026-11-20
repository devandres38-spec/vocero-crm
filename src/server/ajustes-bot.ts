import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { leerAjustesBot, type AjustesBot } from "@/lib/ajustes-bot";
import { leerHorarioHumano, type HorarioHumano } from "@/lib/horario-humano";
import { getRegion } from "@/lib/region";
import { regionDeMetadata } from "@/server/region";

/**
 * 073-B — Lo que el bot de un negocio lee de `organization.metadata`: los
 * ajustes de la plataforma (`bot`: topes, temperatura, respaldo), el horario
 * humano (`humanHours`) y la zona del negocio. Una sola lectura.
 */
export type AjustesDelNegocio = {
  bot: AjustesBot;
  horario: HorarioHumano | null;
  timezone: string;
};

export function ajustesDeMetadata(metadata: string | null): AjustesDelNegocio {
  let meta: Record<string, unknown> = {};
  if (metadata) {
    try {
      const m = JSON.parse(metadata) as unknown;
      if (m && typeof m === "object" && !Array.isArray(m)) meta = m as Record<string, unknown>;
    } catch {
      // metadata ilegible: valen los defaults
    }
  }
  return {
    bot: leerAjustesBot(meta.bot),
    horario: leerHorarioHumano(meta.humanHours),
    timezone: regionDeMetadata(metadata, getRegion()).timezone,
  };
}

export async function ajustesDelNegocio(organizationId: string): Promise<AjustesDelNegocio> {
  const [org] = await getDb()
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return ajustesDeMetadata(org?.metadata ?? null);
}
