import { and, count, eq, gte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { addDaysISO, todayInTz, zonedWallClockToUtc } from "@/lib/time/slots";
import { businessTimezone } from "@/server/analytics/period";

/**
 * 080 (D20) — El tope diario de corridas del Laboratorio.
 *
 * Cuenta TODA corrida creada desde la medianoche del negocio (su zona de la
 * agenda), cualquiera que sea su estado: la que falló también gastó (P2). El
 * tope sale de `organization.lab_corridas_por_dia`, que solo escribe el panel
 * de Andres; `0` apaga el Laboratorio de ese negocio.
 */

export type DiaDelNegocio = {
  /** Medianoche de hoy en la zona del negocio, como instante UTC. */
  desde: Date;
  /** Medianoche de mañana: cuando se libera el tope. */
  seLibera: Date;
  zona: string;
};

/** Pura: el día del negocio que contiene `ahora`. */
export function diaDelNegocio(ahora: Date, _zona: string): DiaDelNegocio {
  // SABOTAJE 3: contar las corridas en UTC en vez de la zona del negocio.
  const z = "UTC";
  const hoy = todayInTz(ahora, z);
  const desde = zonedWallClockToUtc(hoy, "00:00", z) ?? ahora;
  const seLibera = zonedWallClockToUtc(addDaysISO(hoy, 1), "00:00", z) ?? ahora;
  return { desde, seLibera, zona: z };
}

export type EstadoTope = {
  corridasHoy: number;
  topeDiario: number;
  disponible: boolean;
  seLibera: Date;
  zona: string;
};

/** Pura: con lo contado y el tope, si queda corrida. */
export function estadoDelTope(
  corridasHoy: number,
  topeDiario: number,
  dia: DiaDelNegocio
): EstadoTope {
  return {
    corridasHoy,
    topeDiario,
    disponible: corridasHoy < topeDiario,
    seLibera: dia.seLibera,
    zona: dia.zona,
  };
}

/** El tope de este negocio (por defecto 3, si la fila no existiera). */
export async function topeDiarioDe(organizationId: string): Promise<number> {
  const [fila] = await getDb()
    .select({ tope: schema.organization.labCorridasPorDia })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return fila?.tope ?? 3;
}

type Lector = Pick<ReturnType<typeof getDb>, "select">;

/** Corridas creadas desde `desde` (cualquier estado). */
export async function corridasDesde(
  db: Lector,
  organizationId: string,
  desde: Date
): Promise<number> {
  const [fila] = await db
    .select({ n: count() })
    .from(schema.agentTestRun)
    .where(
      and(
        eq(schema.agentTestRun.organizationId, organizationId),
        gte(schema.agentTestRun.startedAt, desde)
      )
    );
  return Number(fila?.n ?? 0);
}

/** El día del negocio de ahora, con su zona de la agenda. */
export async function diaDe(organizationId: string, ahora = new Date()): Promise<DiaDelNegocio> {
  return diaDelNegocio(ahora, await businessTimezone(organizationId));
}

/** Para `GET /api/lab/runs` y la pantalla. */
export async function estadoTopeDe(
  organizationId: string,
  ahora = new Date()
): Promise<EstadoTope> {
  const [dia, tope] = await Promise.all([
    diaDe(organizationId, ahora),
    topeDiarioDe(organizationId),
  ]);
  const hechas = await corridasDesde(getDb(), organizationId, dia.desde);
  return estadoDelTope(hechas, tope, dia);
}

/** Lo que dice la ruta con el tope alcanzado. */
export function mensajeTope(topeDiario: number, seLibera: Date, zona: string): string {
  if (topeDiario === 0) {
    return "El Laboratorio está apagado para este negocio. Avísale a Aliantis si lo necesitas.";
  }
  const hora = new Intl.DateTimeFormat("es-CO", {
    timeZone: zona,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(seLibera);
  const plural = topeDiario === 1 ? "corrida" : "corridas";
  return `Llegaste al tope de ${topeDiario} ${plural} del Laboratorio por día. Vuelve a estar disponible el ${hora} (hora del negocio).`;
}
