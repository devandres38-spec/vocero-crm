import {
  hastaDosOrganizacionesSistema,
  organizacionExisteSistema,
} from "@/server/db-sistema";

/**
 * 073 — Las dos consultas de organización que necesita `requireBot`. Aparte
 * para poder simularlas en las pruebas de cada ruta sin simular la base.
 *
 * 075 — Corren antes de saber el negocio, así que van por las funciones de
 * solo ids de la migración 0033 (`organization` tiene RLS).
 */

export async function organizacionExiste(organizationId: string): Promise<boolean> {
  return organizacionExisteSistema(organizationId);
}

/** Hasta dos organizaciones: basta para saber si hay una sola. Sin caché: una segunda la apaga al instante. */
export async function hastaDosOrganizaciones(): Promise<string[]> {
  return hastaDosOrganizacionesSistema();
}
