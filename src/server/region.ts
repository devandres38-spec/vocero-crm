import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { isCurrency } from "@/lib/money";
import { esLocale, esPais, esZonaValida, getRegion, type Region } from "@/lib/region";
import { esPlataforma } from "@/lib/tenancy";

/**
 * 069 (US6, D9, FR-012) — La región de UN negocio: lo que guardó en
 * `organization.metadata.region` (país, locale, zona) y su moneda de
 * `metadata.branding`, sobre los valores de la instancia (`REGION_*`).
 *
 * En `single` es la de la instancia sin tocar la base (comportamiento 2.8.0:
 * la región era de la instancia). Un valor guardado que no valida se ignora
 * —como una variable `REGION_*` mal escrita— en vez de romper la pantalla.
 */

type Fila = { metadata: string | null };

/** Pura: la región de una fila de organización sobre la de la instancia. */
export function regionDeMetadata(metadata: string | null, instancia: Region): Region {
  let meta: Record<string, unknown> = {};
  try {
    const m = metadata ? (JSON.parse(metadata) as unknown) : null;
    if (m && typeof m === "object" && !Array.isArray(m)) meta = m as Record<string, unknown>;
  } catch {
    meta = {};
  }
  const r = (meta.region && typeof meta.region === "object" ? meta.region : {}) as Record<string, unknown>;
  const b = (meta.branding && typeof meta.branding === "object" ? meta.branding : {}) as Record<string, unknown>;
  const texto = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    country: esPais(texto(r.country)) ? texto(r.country) : instancia.country,
    locale: esLocale(texto(r.locale)) ? texto(r.locale) : instancia.locale,
    timezone: esZonaValida(texto(r.timezone)) ? texto(r.timezone) : instancia.timezone,
    currency: isCurrency(b.currency) ? b.currency : instancia.currency,
  };
}

/**
 * 069 (H-07) — El locale con que se le habla al equipo de un negocio (fechas
 * de citas, números de los avisos). En `single`, el de la instancia sin
 * tocar la base.
 */
export async function localeDeOrganizacion(organizationId: string | null | undefined): Promise<string> {
  return (await getRegionDeOrganizacion(organizationId)).locale;
}

export async function getRegionDeOrganizacion(organizationId: string | null | undefined): Promise<Region> {
  const instancia = getRegion();
  if (!organizationId || !esPlataforma()) return instancia;
  const filas: Fila[] = await getDb()
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return filas[0] ? regionDeMetadata(filas[0].metadata, instancia) : instancia;
}
