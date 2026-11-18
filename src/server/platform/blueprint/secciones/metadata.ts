import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { normalizeBranding, type Branding } from "@/lib/branding";
import type { OrganizationBlueprint } from "@/lib/platform/blueprint";
import { aparienciaSchema } from "@/lib/temas";

/**
 * 069 — Secciones que viven en la fila de la organización: `organization`
 * (nombre), `region` (`metadata.region`, D9) y `brand` (`metadata.branding`,
 * el mismo que edita Ajustes → Marca; el icono no se toca) y `appearance`
 * (`metadata.apariencia`, la de Ajustes → Apariencia; se reemplaza entera).
 */

type Db = ReturnType<typeof getDb>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type OrgParaBlueprint = {
  id: string;
  name: string;
  slug: string | null;
  metadata: string | null;
  modules: unknown;
};

export function leerMetadata(metadata: string | null): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const m = JSON.parse(metadata) as unknown;
    return m && typeof m === "object" && !Array.isArray(m) ? (m as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export type RegionGuardada = { country?: string; locale?: string; timezone?: string };

export function regionGuardada(meta: Record<string, unknown>): RegionGuardada {
  const r = meta.region;
  if (!r || typeof r !== "object") return {};
  const o = r as Record<string, unknown>;
  const out: RegionGuardada = {};
  for (const k of ["country", "locale", "timezone"] as const) {
    if (typeof o[k] === "string") out[k] = o[k] as string;
  }
  return out;
}

export async function aplicarMetadata(
  tx: Tx,
  org: OrgParaBlueprint,
  bp: OrganizationBlueprint,
  created: boolean
): Promise<{ organization: boolean; region: boolean; brand: boolean; appearance: boolean }> {
  const meta = leerMetadata(org.metadata);
  let region = false;
  let brand = false;
  let appearance = false;

  if (bp.region) {
    const actual = regionGuardada(meta);
    const nueva: RegionGuardada = { ...actual, ...limpiar(bp.region) };
    region = !igual(actual, nueva);
    if (region) meta.region = nueva;
  }

  // Al crear, la marca nace con el nombre del negocio aunque no venga `brand`.
  if (bp.brand || created) {
    const actual = normalizeBranding((meta.branding as Partial<Branding> | undefined) ?? null);
    const deseada = normalizeBranding({
      ...actual,
      ...(created && !bp.brand?.name ? { name: org.name } : {}),
      ...limpiar(bp.brand ?? {}),
    });
    brand = !igual(actual, deseada) || (created && meta.branding === undefined);
    if (brand) meta.branding = deseada;
  }

  if (bp.appearance) {
    const actual = aparienciaGuardada(meta);
    const deseada = limpiar(bp.appearance);
    appearance = actual === null || !igual(actual, deseada);
    if (appearance) meta.apariencia = deseada;
  }

  const nombre = bp.organization?.name;
  const organization = !created && nombre !== undefined && nombre !== org.name;

  const metadata = region || brand || appearance;
  if (metadata || organization) {
    await tx
      .update(schema.organization)
      .set({
        ...(organization ? { name: nombre } : {}),
        ...(metadata ? { metadata: JSON.stringify(meta) } : {}),
      })
      .where(eq(schema.organization.id, org.id));
  }
  return { organization, region, brand, appearance };
}

/** La apariencia guardada si es válida (sin claves indefinidas), o null. */
export function aparienciaGuardada(meta: Record<string, unknown>): Record<string, unknown> | null {
  const r = aparienciaSchema.safeParse(meta.apariencia);
  return r.success ? limpiar(r.data) : null;
}

function limpiar<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function igual(a: unknown, b: unknown): boolean {
  return JSON.stringify(ordenar(a)) === JSON.stringify(ordenar(b));
}

function ordenar(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(ordenar);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, ordenar(x)])
    );
  }
  return v;
}

export { igual as igualProfundo };
