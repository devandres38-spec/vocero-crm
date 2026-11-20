import type { z } from "zod";
import type { IconoNav } from "@/verticals/tipos";

/**
 * 072-B (D2, D13, D16, FR-040) — Un MÓDULO es una capacidad con código
 * (páginas en `/m/<clave>`, APIs en `/api/m/<clave>`, herramientas del
 * cerebro), encendida por organización en `organization.modules.modules`.
 * Un Vertical Pack solo lo RECOMIENDA; nunca lo contiene.
 *
 * Dos mitades, a propósito:
 *
 * - `DefinicionModulo` (este archivo + `<clave>/modulo.ts`): DATOS puros y
 *   serializables (menú, widgets, secciones de la ficha). Los lee el catálogo
 *   (`src/modulos/catalogo.ts`), que también importa código de cliente
 *   (`server/modulos/efectivos.ts` llega al formulario de `/platform`).
 * - `ModuleTool` (`<clave>/herramientas.ts`): código de servidor. Solo lo
 *   importa `src/modulos/registro.ts`, y a ese solo el puente del cerebro.
 *
 * Contrato: `specs/072-motor-multi-nicho/contracts/brains-072.md` §3–§4.
 */

/** Clave de módulo: minúsculas, 3–24, sin guiones (es prefijo de herramientas). */
export const CLAVE_MODULO_RE = /^[a-z][a-z0-9]{2,23}$/;
/** Nombre de herramienta (contrato §3): además, empieza por `<modulo>_`. */
export const NOMBRE_HERRAMIENTA_RE = /^[a-z][a-z0-9_]{2,47}$/;
/** Clave de un widget o sección dentro de su módulo. */
export const CLAVE_APORTE_RE = /^[a-z][a-z0-9_]{1,39}$/;

/** Una entrada del menú. Va al grupo «Trabajo», después de las del núcleo. */
export type EntradaNavModulo = {
  /** Siempre bajo `/m/<clave>` (prueba-guardarraíl). */
  href: `/m/${string}`;
  label: string;
  icono: IconoNav;
};

/** Un widget del Inicio: se pide como `{ tipo: "<modulo>.<clave>" }`. */
export type WidgetDeModulo = { clave: string; titulo: string };

/** Una sección de la ficha lateral (debajo de la del núcleo). */
export type SeccionFichaDeModulo = { clave: string; titulo: string };

export type DefinicionModulo = {
  clave: string;
  etiqueta: string;
  descripcion: string;
  /**
   * `true` = de uso interno de la agencia (como `diagnostico`): no se ofrece
   * en los catálogos para recomendar ni en los formularios de `/platform`.
   * Solo se enciende con `modules.modules` en un Blueprint (o el MCP).
   */
  oculto: boolean;
  nav: EntradaNavModulo[];
  widgets: WidgetDeModulo[];
  seccionesFicha: SeccionFichaDeModulo[];
};

/** Identidad con tipos: el valor tal cual, comprobado contra la forma. */
export function defineModulo<const M extends DefinicionModulo>(m: M): M {
  return m;
}

/* ---------------------------- Herramientas ---------------------------- */

/**
 * `lectura`: se ejecuta cada vez. `escritura`: idempotente por
 * (`dispatchId`, nombre, argumentos) en `brain_tool_call` (D14).
 */
export type Efecto = "lectura" | "escritura";

export type ResultadoHerramienta =
  | { ok: true; result: Record<string, unknown>; estado?: "hecho" | "en_curso" }
  | { ok: false; error: string; detalle?: string };

export type ContextoHerramienta = {
  /** Del ámbito de la credencial (`withBrain`), nunca del cuerpo. */
  organizationId: string;
  /** Ya comprobada: es de esta organización y la IA no está en pausa. */
  conversationId: string;
  dispatchId: string;
  /** Se aborta a los 8 s: el manejador debe soltar lo que esté haciendo. */
  signal: AbortSignal;
};

export type ModuleTool<A extends z.ZodType = z.ZodType> = {
  /** `<modulo>_<algo>` (prueba en `tests/unit/modulos-072b.test.ts`). */
  nombre: string;
  /** ≤400, revisada en código: el modelo la lee tal cual. */
  descripcion: string;
  /** Se publica como JSON Schema (`z.toJSONSchema`) y valida cada llamada. */
  args: A;
  efecto: Efecto;
  ejecutar(ctx: ContextoHerramienta, args: z.infer<A>): Promise<ResultadoHerramienta>;
};

/** Identidad con tipos para que `ejecutar` reciba `args` ya tipados. */
export function defineHerramienta<A extends z.ZodType>(t: ModuleTool<A>): ModuleTool<A> {
  return t;
}
