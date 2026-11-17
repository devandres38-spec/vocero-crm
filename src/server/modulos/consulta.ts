import { eq } from "drizzle-orm";
import type { Channel } from "@/lib/channels";
import { getDb, schema } from "@/lib/db";
import { esPlataforma } from "@/lib/tenancy";
import {
  modulosEfectivos,
  techoDeInstancia,
  type ModulosEfectivos,
} from "@/server/modulos/efectivos";

/**
 * 069 (D11, FR-015) — Cómo pregunta el código si un módulo existe para UNA
 * organización. Toda superficie con organización pasa por aquí; las banderas
 * de instancia (`agendaEnabled()`, `atribucionEnabled()`,
 * `isChannelEnabled()`) quedan como el techo y solo las consultan las
 * superficies sin organización (guardarraíl `modulos-por-organizacion`).
 */

type ConModulos = { organizationId?: string; modulos?: ModulosEfectivos } | null | undefined;

/**
 * Los módulos de la sesión (ya calculados por el resolvedor, sin consultas).
 * Si el contexto no los trae (armado a mano), los del techo.
 */
export function modulosDe(s: ConModulos): ModulosEfectivos {
  return s?.modulos ?? modulosEfectivos(techoDeInstancia(), null);
}

export function agendaActiva(s: ConModulos): boolean {
  return modulosDe(s).agenda;
}

export function atribucionActiva(s: ConModulos): boolean {
  return modulosDe(s).atribucion;
}

export function canalActivo(s: ConModulos, canal: Channel): boolean {
  return modulosDe(s).channels.includes(canal);
}

/**
 * Para el código que solo tiene el id (ingesta, envío, contexto del cerebro,
 * conversiones). En `single` es el techo sin tocar la base (como en 2.8.0);
 * en `multi` lee la columna de la organización.
 */
export async function modulosDeOrganizacion(organizationId: string): Promise<ModulosEfectivos> {
  const techo = techoDeInstancia();
  if (!esPlataforma()) return modulosEfectivos(techo, null);
  const rows = await getDb()
    .select({ modules: schema.organization.modules })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return modulosEfectivos(techo, rows[0]?.modules ?? null);
}
