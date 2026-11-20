import { z } from "zod";
import { CLAVE_CAMPO_RE } from "@/lib/ficha-campos";
import { moduloDe, type SeccionFichaRef } from "@/modulos/catalogo";
import type { EntradaNavModulo } from "@/modulos/tipos";
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
        // M-3 (auditoría 072-A) — La Bandeja nunca se oculta (el menú la
        // ignoraba en silencio): se rechaza para que quien lo pida lo sepa.
        ocultas: z
          .array(hrefSchema.refine((h) => h !== "/inbox", { message: "bandeja_no_se_oculta" }))
          .max(20)
          .optional(),
        orden: z.array(hrefSchema).max(20).optional(),
      })
      .strict()
      .optional(),
    // M-3 — Un Inicio sin widgets es una página vacía: para no tener Inicio,
    // se usa un pack sin él (o no se manda `inicio`).
    inicio: z.object({ widgets: z.array(widgetRefSchema).min(1).max(8) }).strict().optional(),
  })
  .strict()
  // M-3 — El tope es en BYTES UTF-8 (lo que ocupa en la base), no en
  // unidades UTF-16: «ñ» o un emoji pesan más de 1.
  .refine((o) => bytesUtf8(JSON.stringify(o)) <= TOPE_OVERRIDES_BYTES, { message: "overrides_grandes" });

export function bytesUtf8(s: string): number {
  return new TextEncoder().encode(s).length;
}

export type VerticalOverrides = z.infer<typeof verticalOverridesSchema>;

/** Lo guardado en la columna; basura = sin overrides (nunca un error). */
export function leerOverrides(raw: unknown, alDescartar?: (motivo: string) => void): VerticalOverrides | null {
  if (raw === null || raw === undefined) return null;
  const r = verticalOverridesSchema.safeParse(raw);
  // B-4 (auditoría 072-A) — Descartar no es silencioso para quien lo pida.
  if (!r.success) alDescartar?.(r.error.issues[0]?.message ?? "invalido");
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
  /**
   * 072-B (D4, FR-040) — Lo que aportan los módulos ENCENDIDOS del negocio
   * (techo ∧ organización): entradas de menú y secciones de la ficha. Los
   * widgets de módulo se piden en `inicio.widgets` (`<modulo>.<clave>`) y se
   * pintan solo si su módulo está en `claves`.
   */
  modulos: { claves: string[]; nav: EntradaNavModulo[]; seccionesFicha: SeccionFichaRef[] };
};

/** Puro: lo que aportan los módulos, en el orden del catálogo pedido. */
export function aportesDeModulos(claves: readonly string[]): ExperienciaResuelta["modulos"] {
  const out: ExperienciaResuelta["modulos"] = { claves: [], nav: [], seccionesFicha: [] };
  for (const clave of claves) {
    const m = moduloDe(clave);
    if (!m || out.claves.includes(m.clave)) continue;
    out.claves.push(m.clave);
    out.nav.push(...m.nav);
    out.seccionesFicha.push(...m.seccionesFicha.map((s) => ({ ...s, modulo: m.clave })));
  }
  return out;
}

/** Puro: pack ⊕ overrides ⊕ módulos encendidos. */
export function resolverExperiencia(
  packId: unknown,
  overridesRaw: unknown,
  modulos: readonly string[] = []
): ExperienciaResuelta {
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
    modulos: aportesDeModulos(modulos),
  };
}

/** La experiencia de un negocio sin pack: la de 2.11.0. */
export const EXPERIENCIA_DEFAULT: ExperienciaResuelta = resolverExperiencia("default", null);
