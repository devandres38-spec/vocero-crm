import { asc, count, desc, eq, gt, gte, isNull, lt, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { CLAVE_CAMPO_RE } from "@/lib/ficha-campos";
import { blockStartUtc } from "@/lib/time/calendar";
import { todayInTz } from "@/lib/time/slots";
import { notLabContact } from "@/server/analytics/shared";

/**
 * 072 (FR-005) — Los datos de los widgets del Inicio. Cada función recibe la
 * organización y TODAS sus consultas pasan por `scoped` (guardarraíl en
 * `tests/unit/inicio-072.test.ts`). Nada del Laboratorio cuenta: un Inicio
 * con pacientes «[Prueba]» le enseña al dueño un negocio que no existe.
 *
 * Son consultas cortas y con tope: el Inicio se abre a diario.
 */

export const TOPE_LISTA_INICIO = 8;
/** Ventana de `proximos_por_fecha`. */
export const DIAS_PROXIMOS = 30;

export type SinResponder = { conversationId: string; nombre: string; pendientes: number; desde: Date | null };

export async function sinResponder(organizationId: string): Promise<{ total: number; lista: SinResponder[] }> {
  const db = getDb();
  const alcance = scoped(
    schema.conversation.organizationId,
    organizationId,
    eq(schema.conversation.isTest, false),
    gt(schema.conversation.unreadCount, 0)
  );
  const [lista, totales] = await Promise.all([
    db
      .select({
        conversationId: schema.conversation.id,
        nombre: schema.contact.name,
        pendientes: schema.conversation.unreadCount,
        desde: schema.conversation.lastInboundAt,
      })
      .from(schema.conversation)
      .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
      .where(alcance)
      .orderBy(desc(schema.conversation.lastInboundAt))
      .limit(TOPE_LISTA_INICIO),
    db.select({ n: count() }).from(schema.conversation).where(alcance),
  ]);
  return { total: Number(totales[0]?.n ?? 0), lista };
}

export type LeadsDeEtapa = { etapa: string; total: number };

/** Leads por etapa ABIERTA, en el orden del pipeline (también las vacías). */
export async function leadsPorEtapa(organizationId: string): Promise<LeadsDeEtapa[]> {
  const db = getDb();
  const [etapas, conteos] = await Promise.all([
    db
      .select({ id: schema.pipelineStage.id, name: schema.pipelineStage.name })
      .from(schema.pipelineStage)
      .where(scoped(schema.pipelineStage.organizationId, organizationId, eq(schema.pipelineStage.kind, "open")))
      .orderBy(asc(schema.pipelineStage.position)),
    db
      .select({ stageId: schema.lead.stageId, n: count() })
      .from(schema.lead)
      .where(scoped(schema.lead.organizationId, organizationId, notLabContact(schema.lead.contactId)))
      .groupBy(schema.lead.stageId),
  ]);
  const por = new Map(conteos.map((c) => [c.stageId, Number(c.n)]));
  return etapas.map((e) => ({ etapa: e.name, total: por.get(e.id) ?? 0 }));
}

/** Puro: el día de hoy del negocio como rango UTC `[desde, hasta)`. */
export function rangoDeHoy(now: Date, tz: string): { hoy: string; desde: Date; hasta: Date } | null {
  const hoy = todayInTz(now, tz);
  const manana = siguienteDia(hoy);
  const desde = blockStartUtc(hoy, "00:00", tz);
  const hasta = blockStartUtc(manana, "00:00", tz);
  return desde && hasta ? { hoy, desde: new Date(desde), hasta: new Date(hasta) } : null;
}

/** Puro: `AAAA-MM-DD` + n días (calendario, sin zona). */
export function siguienteDia(iso: string, n = 1): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export type CitaDeHoy = { id: string; nombre: string | null; hora: Date; estado: string };

export async function citasDeHoy(organizationId: string, tz: string, now: Date = new Date()): Promise<CitaDeHoy[]> {
  const r = rangoDeHoy(now, tz);
  if (!r) return [];
  return getDb()
    .select({
      id: schema.booking.id,
      nombre: schema.contact.name,
      hora: schema.booking.scheduledAt,
      estado: schema.booking.status,
    })
    .from(schema.booking)
    .leftJoin(schema.contact, eq(schema.contact.id, schema.booking.contactId))
    .where(
      scoped(
        schema.booking.organizationId,
        organizationId,
        eq(schema.booking.kind, "session"),
        ne(schema.booking.status, "cancelada"),
        eq(schema.booking.isTest, false),
        gte(schema.booking.scheduledAt, r.desde),
        lt(schema.booking.scheduledAt, r.hasta)
      )
    )
    .orderBy(asc(schema.booking.scheduledAt))
    .limit(TOPE_LISTA_INICIO * 2);
}

export type Proximo = { contactId: string; nombre: string; fecha: string };

/**
 * Contactos cuya fecha (un campo `date` de la ficha, `AAAA-MM-DD`) cae entre
 * hoy y los próximos 30 días. La clave del campo se valida con el mismo
 * patrón de la ficha y viaja como PARÁMETRO, nunca concatenada en el SQL.
 */
export async function proximosPorFecha(
  organizationId: string,
  campo: string,
  tz: string,
  now: Date = new Date()
): Promise<Proximo[]> {
  if (!CLAVE_CAMPO_RE.test(campo)) return [];
  const hoy = todayInTz(now, tz);
  const hasta = siguienteDia(hoy, DIAS_PROXIMOS);
  const fecha = sql<string>`(${schema.contact.ficha} ->> ${campo})`;
  return getDb()
    .select({ contactId: schema.contact.id, nombre: schema.contact.name, fecha })
    .from(schema.contact)
    .where(
      scoped(
        schema.contact.organizationId,
        organizationId,
        sql`${fecha} ~ '^\\d{4}-\\d{2}-\\d{2}$'`,
        sql`${fecha} >= ${hoy}`,
        sql`${fecha} <= ${hasta}`,
        // M-2 (auditoría 072-A) — Un contacto archivado no es un evento próximo.
        isNull(schema.contact.archivedAt),
        notLabContact(schema.contact.id)
      )
    )
    .orderBy(asc(fecha))
    .limit(TOPE_LISTA_INICIO + 2);
}

/** Para las pruebas de aislamiento: las consultas que existen. */
export const CONSULTAS_INICIO = ["sinResponder", "leadsPorEtapa", "citasDeHoy", "proximosPorFecha"] as const;

