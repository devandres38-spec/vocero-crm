import { asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { recursosGuardados, type Recurso } from "@/lib/kb";

/**
 * 074 (D8, FR-02) — LA consulta del conocimiento que ve el cerebro: solo lo
 * activo, fijado primero, luego `sort_order` y antigüedad. La usan
 * `/api/bot/profile`, `/api/brains/context`, el ensayo y el Laboratorio: que
 * el dueño pruebe exactamente lo que va a contestar.
 */
export async function kbParaElCerebro(organizationId: string) {
  const t = schema.kbEntry;
  return getDb()
    .select()
    .from(t)
    .where(scoped(t.organizationId, organizationId, eq(t.enabled, true)))
    .orderBy(desc(t.pinned), asc(t.sortOrder), asc(t.createdAt), asc(t.id));
}

/** Todas (activas y apagadas), en el orden en que las ve el dueño. */
export async function kbDelNegocio(organizationId: string) {
  const t = schema.kbEntry;
  return getDb()
    .select()
    .from(t)
    .where(scoped(t.organizationId, organizationId))
    .orderBy(desc(t.pinned), asc(t.sortOrder), asc(t.createdAt), asc(t.id));
}

/** 074 (FR-05) — Los enlaces verificados del negocio, saneados. */
export async function recursosDe(organizationId: string): Promise<Recurso[]> {
  const [fila] = await getDb()
    .select({ resources: schema.agentProfile.resources })
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  return recursosGuardados(fila?.resources);
}
