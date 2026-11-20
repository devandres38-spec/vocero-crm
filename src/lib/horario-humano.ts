import { z } from "zod";
import {
  addDaysISO,
  dayIsoInTz,
  isValidInterval,
  WEEKDAYS,
  weekdayKeyOf,
  zonedWallClockToUtc,
  type Interval,
  type WeekdayKey,
} from "@/lib/time/slots";

/**
 * 073-B (D6, decisión #7) — El horario en que hay PERSONAS del equipo para
 * atender (no el de la agenda: un negocio puede agendar citas a las 20:00 y
 * no tener a nadie en el chat a esa hora). Uno por negocio, con el mismo
 * `Interval` de la agenda y un interruptor opcional de festivos de Colombia
 * (Ley 51 de 1983, «Ley Emiliani»).
 *
 * Con él, el contexto del cerebro lleva `humanAvailable`/`nextOpenAt` y el
 * agente deja de prometer «ya te contacta un asesor» a las 23:00 de un
 * domingo. Sin configurar, el contexto no lleva nada (como antes).
 */

export type HorarioSemanal = Partial<Record<WeekdayKey, Interval[]>>;

export type HorarioHumano = {
  weeklyHours: HorarioSemanal;
  /** Los festivos de Colombia cuentan como día cerrado. */
  colombianHolidays: boolean;
};

const intervaloSchema = z
  .object({ start: z.string(), end: z.string() })
  .strict()
  .refine(isValidInterval, { message: "intervalo_invalido" });

export const horarioHumanoSchema = z
  .object({
    weeklyHours: z
      .object(Object.fromEntries(WEEKDAYS.map((d) => [d, z.array(intervaloSchema).max(4).optional()])))
      .strict(),
    colombianHolidays: z.boolean().default(false),
  })
  .strict();

/** Lo guardado en `organization.metadata.humanHours`; basura → null. */
export function leerHorarioHumano(valor: unknown): HorarioHumano | null {
  if (valor === null || valor === undefined) return null;
  const r = horarioHumanoSchema.safeParse(valor);
  if (!r.success) return null;
  const weeklyHours: HorarioSemanal = {};
  for (const d of WEEKDAYS) {
    const ivs = (r.data.weeklyHours as Record<string, Interval[] | undefined>)[d];
    if (ivs && ivs.length > 0) weeklyHours[d] = [...ivs].sort((a, b) => a.start.localeCompare(b.start));
  }
  return { weeklyHours, colombianHolidays: r.data.colombianHolidays };
}

// ── Festivos de Colombia ───────────────────────────────────────────────────

/** Domingo de Pascua (algoritmo anónimo gregoriano), `YYYY-MM-DD`. */
export function domingoDePascua(anio: number): string {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** El lunes siguiente (o el mismo día si ya es lunes). */
function alLunes(iso: string): string {
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay(); // 0 = domingo
  const hasta = (8 - dow) % 7;
  return addDaysISO(iso, hasta);
}

const FIJOS = ["01-01", "05-01", "07-20", "08-07", "12-08", "12-25"];
/** Los que la Ley Emiliani traslada al lunes. */
const TRASLADABLES = ["01-06", "03-19", "06-29", "08-15", "10-12", "11-01", "11-11"];

const cache = new Map<number, Set<string>>();

/** Los 18 festivos de Colombia de un año, en `YYYY-MM-DD`. */
export function festivosDeColombia(anio: number): Set<string> {
  const hit = cache.get(anio);
  if (hit) return hit;
  const pascua = domingoDePascua(anio);
  const out = new Set<string>([
    ...FIJOS.map((md) => `${anio}-${md}`),
    ...TRASLADABLES.map((md) => alLunes(`${anio}-${md}`)),
    addDaysISO(pascua, -3), // Jueves Santo
    addDaysISO(pascua, -2), // Viernes Santo
    alLunes(addDaysISO(pascua, 39)), // Ascensión
    alLunes(addDaysISO(pascua, 60)), // Corpus Christi
    alLunes(addDaysISO(pascua, 68)), // Sagrado Corazón
  ]);
  cache.set(anio, out);
  return out;
}

export function esFestivoColombia(iso: string): boolean {
  return festivosDeColombia(Number(iso.slice(0, 4))).has(iso);
}

// ── Disponibilidad ─────────────────────────────────────────────────────────

export type Disponibilidad = {
  humanAvailable: boolean;
  /** Próxima apertura (ISO UTC) si ahora está cerrado; null si está abierto o no hay ninguna en 14 días. */
  nextOpenAt: string | null;
};

/** ¿Hay personas ahora? Y si no, ¿cuándo vuelven? (busca hasta 14 días). */
export function disponibilidadHumana(horario: HorarioHumano, ahora: Date, tz: string): Disponibilidad {
  const hoy = dayIsoInTz(ahora, tz);
  const t = ahora.getTime();
  for (let n = 0; n <= 14; n++) {
    const dia = addDaysISO(hoy, n);
    if (horario.colombianHolidays && esFestivoColombia(dia)) continue;
    const clave = weekdayKeyOf(dia, tz);
    const ivs = (clave && horario.weeklyHours[clave]) || [];
    for (const iv of ivs) {
      const inicio = zonedWallClockToUtc(dia, iv.start, tz);
      const fin = zonedWallClockToUtc(dia, iv.end, tz);
      if (!inicio || !fin) continue;
      if (n === 0 && inicio.getTime() <= t && t < fin.getTime()) {
        return { humanAvailable: true, nextOpenAt: null };
      }
      if (inicio.getTime() > t) return { humanAvailable: false, nextOpenAt: inicio.toISOString() };
    }
  }
  return { humanAvailable: false, nextOpenAt: null };
}
