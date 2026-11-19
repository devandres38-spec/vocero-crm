import type { FichaField } from "@/lib/ficha-campos";
import type { BlueprintEntrada } from "@/lib/platform/blueprint";

/**
 * 072 (D2, D3) — Un Vertical Pack es PRESENTACIÓN + SEMILLA, y nada más:
 * vocabulario, menú, inicio, campos de ficha sugeridos, Blueprint semilla y
 * personas del Laboratorio. Son datos tipados y versionados con el código.
 *
 * Prohibido en un pack (prueba en `tests/unit/verticals-072.test.ts`):
 * componentes, rutas, consultas, herramientas del bot y cualquier lógica por
 * organización. Lo que necesite código es un MÓDULO (`src/modulos/`, 072-B).
 *
 * Contrato: `specs/072-motor-multi-nicho/contracts/vertical-packs.md`.
 */

export const TERMINOS = [
  "contacto",
  "lead",
  "pipeline",
  "cita",
  "bandeja",
  "ficha",
  "inicio",
  "resultados",
  "agente",
  "etapa",
] as const;
export type TerminoVocabulario = (typeof TERMINOS)[number];

export type Termino = { uno: string; varios: string };

/** Íconos que un pack puede nombrar (lista cerrada; los mapea `src/lib/nav.ts`). */
export const ICONOS_NAV = [
  "inicio",
  "bandeja",
  "pipeline",
  "contactos",
  "citas",
  "agente",
  "laboratorio",
  "resultados",
  "guia",
  "salud",
  "evento",
] as const;
export type IconoNav = (typeof ICONOS_NAV)[number];

export const WIDGETS_NUCLEO = [
  "sin_responder",
  "leads_por_etapa",
  "citas_de_hoy",
  "proximos_por_fecha",
  "accesos_rapidos",
] as const;
export type TipoWidgetNucleo = (typeof WIDGETS_NUCLEO)[number];

export type WidgetRef =
  | { tipo: Exclude<TipoWidgetNucleo, "proximos_por_fecha"> }
  | { tipo: "proximos_por_fecha"; params: { campo: string; titulo?: string } }
  /** Widget de un módulo (`<modulo>.<widget>`, 072-B): sin el módulo, no se pinta. */
  | { tipo: `${string}.${string}` };

/** Una persona guionada del Laboratorio (la forma de `server/lab/personas.ts`). */
export type PersonaDePack = {
  key: string;
  label: string;
  description: string;
  /** Teléfono sintético estable (`57000000…`: nunca un número real). */
  phone: string;
  contactName: string;
  script: string[];
};

/** La semilla: una parte del Blueprint, sin lo que es de cada negocio. */
export type SemillaPack = Omit<BlueprintEntrada, "version" | "organization" | "owner" | "brain" | "region">;

export type VerticalPack = {
  id: string;
  label: string;
  description: string;
  vocabulario: Partial<Record<TerminoVocabulario, Termino>>;
  nav: {
    /** `href` en el orden en que se leen dentro de su grupo. */
    orden?: string[];
    ocultas?: string[];
    iconos?: Partial<Record<string, IconoNav>>;
  };
  /** `null` = sin `/inicio`: la raíz va a la Bandeja como en 2.11.0. */
  inicio: { widgets: WidgetRef[] } | null;
  /** Sugeridos; viajan en la semilla (`semilla.fichaFields`). */
  fichaFields: FichaField[];
  semilla: SemillaPack;
  /** Propias del nicho; las universales se suman solas (`server/lab/personas.ts`). */
  personas: PersonaDePack[];
  /** Claves del registro de módulos (072-B). Recomendación, no encendido. */
  modulosRecomendados: string[];
};

/** Lo que el pack hijo declara: todo opcional salvo identidad. */
export type PackParcial = Pick<VerticalPack, "id" | "label" | "description"> &
  Partial<Omit<VerticalPack, "id" | "label" | "description">>;
