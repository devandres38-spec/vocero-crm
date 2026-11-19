import { HERRAMIENTAS_DIAGNOSTICO } from "@/modulos/diagnostico/herramientas";
import type { ClaveModulo } from "@/modulos/catalogo";
import type { ModuleTool } from "@/modulos/tipos";

/**
 * 072-B (FR-040) — El registro de SERVIDOR: las herramientas del cerebro de
 * cada módulo. Lo importa solo el puente (`src/server/brains/herramientas.ts`);
 * el núcleo no importa `src/modulos/*` fuera de `catalogo.ts`, este archivo y
 * `registro-cliente.ts` (prueba-guardarraíl).
 *
 * `Record<ClaveModulo, …>`: un módulo nuevo en el catálogo no compila hasta
 * declarar aquí sus herramientas (aunque sean ninguna).
 */
export const HERRAMIENTAS_POR_MODULO: Record<ClaveModulo, readonly ModuleTool[]> = {
  diagnostico: HERRAMIENTAS_DIAGNOSTICO as readonly ModuleTool[],
};

export function herramientasDe(clave: string): readonly ModuleTool[] {
  return (HERRAMIENTAS_POR_MODULO as Record<string, readonly ModuleTool[]>)[clave] ?? [];
}
