"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";

/**
 * 072-B (D17, FR-040) — El ÚNICO import del núcleo hacia piezas de cliente
 * de los módulos, y siempre con `next/dynamic`: el JS de un módulo solo lo
 * descarga un negocio que lo tiene encendido (y una pantalla que lo pinta).
 *
 * Claves `"<modulo>.<clave>"`, las mismas que declara su `modulo.ts`
 * (`widgets` y `seccionesFicha`; prueba en `tests/unit/modulos-072b.test.ts`).
 */

export type PropsSeccionFicha = { conversationId: string };

const cargando = () => <p className="text-xs text-text-3">Cargando…</p>;

export const SECCIONES_FICHA: Record<string, ComponentType<PropsSeccionFicha>> = {
  "diagnostico.marcas": dynamic(() => import("@/modulos/diagnostico/cliente/seccion-marcas"), { loading: cargando }),
};

export const WIDGETS: Record<string, ComponentType> = {
  "diagnostico.estado": dynamic(() => import("@/modulos/diagnostico/cliente/widget-estado"), { loading: cargando }),
};

/** Un widget de módulo dentro de la tarjeta del Inicio (Server Component). */
export function WidgetDeModulo({ tipo }: { tipo: string }) {
  const W = WIDGETS[tipo];
  return W ? <W /> : null;
}
