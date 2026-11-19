import { eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import type { OrganizationBlueprint } from "@/lib/platform/blueprint";
import { leerOverrides } from "@/verticals/resolver";
import { igualProfundo, type Tx } from "./metadata";

/** Los `href` que existen en el menú del núcleo (072-A; los de módulo llegan en la 072-B). */
export const HREFS_DEL_MENU = [
  "/inicio",
  "/inbox",
  "/pipeline",
  "/contacts",
  "/bookings",
  "/onboarding",
  "/agent",
  "/lab",
  "/results",
] as const;

/**
 * 072 (D20) — El Vertical Pack y los ajustes del negocio. Cambiar de pack NO
 * aplica su plantilla (eso es mandar su semilla). `overrides` ausente = no se
 * tocan; `null` = se quitan.
 *
 * Advertencias (no errores): un `href` que no está en el menú o un widget de
 * un módulo que no existe todavía se guardan pero no se pintan.
 */
export async function aplicarVertical(
  tx: Tx,
  organizationId: string,
  deseado: NonNullable<OrganizationBlueprint["vertical"]>
): Promise<{ cambio: boolean; advertencias: string[] }> {
  const [fila] = await tx
    .select({ pack: schema.organization.verticalPack, overrides: schema.organization.verticalOverrides })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  const actual = { pack: fila?.pack ?? "default", overrides: leerOverrides(fila?.overrides ?? null) };
  const nuevo = {
    pack: deseado.pack,
    overrides: deseado.overrides === undefined ? actual.overrides : deseado.overrides,
  };
  const advertencias = advertenciasDeOverrides(nuevo.overrides);
  if (actual.pack === nuevo.pack && igualProfundo(actual.overrides ?? null, nuevo.overrides ?? null)) {
    return { cambio: false, advertencias };
  }
  await tx
    .update(schema.organization)
    .set({ verticalPack: nuevo.pack, verticalOverrides: (nuevo.overrides ?? null) as Record<string, unknown> | null })
    .where(eq(schema.organization.id, organizationId));
  return { cambio: true, advertencias };
}

/** Puro: lo que se guarda pero no se va a ver. */
export function advertenciasDeOverrides(o: ReturnType<typeof leerOverrides> | undefined): string[] {
  if (!o) return [];
  const conocidos = new Set<string>(HREFS_DEL_MENU);
  const out: string[] = [];
  for (const href of [...(o.nav?.ocultas ?? []), ...(o.nav?.orden ?? [])]) {
    if (!conocidos.has(href) && !out.includes(`href_desconocido:${href}`)) out.push(`href_desconocido:${href}`);
  }
  for (const w of o.inicio?.widgets ?? []) {
    if (w.tipo.includes(".")) out.push(`widget_sin_modulo:${w.tipo}`);
  }
  return out;
}
