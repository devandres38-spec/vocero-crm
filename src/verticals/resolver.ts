import { z } from "zod";
import { CLAVE_CAMPO_RE } from "@/lib/ficha-campos";
import { packDe } from "./registro";
import { TERMINOS, WIDGETS_NUCLEO, type IconoNav, type WidgetRef } from "./tipos";
import { VOCABULARIO_BASE, type Vocabulario } from "./vocabulario";

/**
 * 072 (D5) — Los ajustes de UN negocio sobre su pack: solo datos, y solo los
 * escribe la agencia (Blueprint, `/platform`, MCP). Si un cliente necesita
 * código, lo que necesita es un módulo o un pack, nunca una carpeta suya.
 */

export const TOPE_OVERRIDES_BYTES = 4096;
const HREF_RE = /^\/[a-z0-9][a-z0-9/-]{0,59}$/;

const terminoSchema = z
  .object({ uno: z.string().trim().min(1).max(30), varios: z.string().trim().min(1).max(30) })
  .strict();

const hrefSchema = z
  .string()
  .regex(HREF_RE, { message: "href_invalido" })
  .refine((h) => h !== "/settings" && !h.startsWith("/settings/"), { message: "ajustes_no_se_ocultan" });

export const widgetRefSchema = z.union([
  z
    .object({ tipo: z.enum(WIDGETS_NUCLEO).exclude(["proximos_por_fecha"]) })
    .strict(),
  z
    .object({
      tipo: z.literal("proximos_por_fecha"),
      params: z
        .object({ campo: z.string().regex(CLAVE_CAMPO_RE), titulo: z.string().trim().min(1).max(40).optional() })
        .strict(),
    })
    .strict(),
  z.object({ tipo: z.string().regex(/^[a-z][a-z0-9]{2,23}\.[a-z][a-z0-9_]{1,39}$/) }).strict(),
]);

export const verticalOverridesSchema = z
  .object({
    vocabulario: z.partialRecord(z.enum(TERMINOS), terminoSchema).optional(),
    nav: z
      .object({
        ocultas: z.array(hrefSchema).max(20).optional(),
        orden: z.array(hrefSchema).max(20).optional(),
      })
      .strict()
      .optional(),
    inicio: z.object({ widgets: z.array(widgetRefSchema).max(8) }).strict().optional(),
  })
  .strict()
  .refine((o) => JSON.stringify(o).length <= TOPE_OVERRIDES_BYTES, { message: "overrides_grandes" });

export type VerticalOverrides = z.infer<typeof verticalOverridesSchema>;

/** Lo guardado en la columna; basura = sin overrides (nunca un error). */
export function leerOverrides(raw: unknown): VerticalOverrides | null {
  if (raw === null || raw === undefined) return null;
  const r = verticalOverridesSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/**
 * Lo que la UI necesita de la experiencia de un negocio. SERIALIZABLE: baja
 * del servidor al cliente por props (D17), sin funciones ni componentes.
 */
export type ExperienciaResuelta = {
  pack: string;
  vocabulario: Vocabulario;
  nav: { orden: string[]; ocultas: string[]; iconos: Record<string, IconoNav> };
  inicio: { widgets: WidgetRef[] } | null;
};

/** Puro: pack ⊕ overrides. Los aportes de módulos llegan en la 072-B. */
export function resolverExperiencia(packId: unknown, overridesRaw: unknown): ExperienciaResuelta {
  const pack = packDe(packId);
  const o = leerOverrides(overridesRaw);
  const iconos: Record<string, IconoNav> = {};
  for (const [href, icono] of Object.entries(pack.nav.iconos ?? {})) if (icono) iconos[href] = icono;
  return {
    pack: pack.id,
    vocabulario: { ...VOCABULARIO_BASE, ...pack.vocabulario, ...o?.vocabulario },
    nav: {
      orden: o?.nav?.orden ?? pack.nav.orden ?? [],
      ocultas: o?.nav?.ocultas ?? pack.nav.ocultas ?? [],
      iconos,
    },
    inicio: o?.inicio ? { widgets: o.inicio.widgets as WidgetRef[] } : pack.inicio,
  };
}

/** La experiencia de un negocio sin pack: la de 2.11.0. */
export const EXPERIENCIA_DEFAULT: ExperienciaResuelta = resolverExperiencia("default", null);
