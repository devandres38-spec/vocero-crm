import { DIAGNOSTICO } from "@/modulos/diagnostico/modulo";
import type { DefinicionModulo, SeccionFichaDeModulo, WidgetDeModulo } from "@/modulos/tipos";

/**
 * 072-B (FR-040) — El catálogo de módulos: SOLO datos (sin herramientas ni
 * consultas), así que lo puede importar cualquier lado. Un módulo nuevo es
 * una carpeta `src/modulos/<clave>/` + una línea aquí (y otra en
 * `registro.ts` si trae herramientas, y en `registro-cliente.ts` si trae
 * piezas de cliente).
 */
export const MODULOS = [DIAGNOSTICO] as const satisfies readonly DefinicionModulo[];

export type ClaveModulo = (typeof MODULOS)[number]["clave"];

/** Las claves válidas de `organization.modules.modules`. */
export const CLAVES_MODULO: readonly string[] = MODULOS.map((m) => m.clave);

export function moduloDe(clave: string): DefinicionModulo | undefined {
  return (MODULOS as readonly DefinicionModulo[]).find((m) => m.clave === clave);
}

/** `"<modulo>.<clave>"` → el widget declarado, o `undefined`. */
export function widgetDeModulo(tipo: string): (WidgetDeModulo & { modulo: string }) | undefined {
  const [modulo, clave] = tipo.split(".");
  const w = modulo && clave ? moduloDe(modulo)?.widgets.find((x) => x.clave === clave) : undefined;
  return w && modulo ? { ...w, modulo } : undefined;
}

export type SeccionFichaRef = SeccionFichaDeModulo & { modulo: string };
