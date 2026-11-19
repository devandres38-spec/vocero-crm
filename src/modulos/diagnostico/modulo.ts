import { defineModulo } from "@/modulos/tipos";

/**
 * 072-B (D18, FR-045) — Módulo `diagnostico`: prueba de punta a punta el
 * marco de módulos y el puente del cerebro sin lógica de un nicho real.
 *
 * Oculto: solo lo enciende la agencia (`modules.modules: ["diagnostico"]` en
 * un Blueprint o por el MCP), en negocios de staging. Aporta una entrada al
 * menú, un widget del Inicio (si el negocio lo pide en `inicio.widgets`), una
 * sección en la ficha lateral y dos herramientas del cerebro:
 * `diagnostico_eco` (lectura) y `diagnostico_marca` (escritura idempotente).
 */
export const DIAGNOSTICO = defineModulo({
  clave: "diagnostico",
  etiqueta: "Diagnóstico",
  descripcion: "Prueba interna del marco de módulos y del puente de herramientas del cerebro.",
  oculto: true,
  nav: [{ href: "/m/diagnostico", label: "Diagnóstico", icono: "modulo" }],
  widgets: [{ clave: "estado", titulo: "Diagnóstico" }],
  seccionesFicha: [{ clave: "marcas", titulo: "Diagnóstico" }],
});

/** El prefijo con que el módulo firma sus notas en la conversación. */
export const PREFIJO_MARCA = "[Diagnóstico]";
