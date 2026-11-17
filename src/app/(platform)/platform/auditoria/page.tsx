import { and, desc, eq, type SQL } from "drizzle-orm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb, schema } from "@/lib/db";
import { listarOrganizaciones } from "@/server/platform/organizaciones";

export const dynamic = "force-dynamic";

const VIAS = ["sesion", "api", "mcp"] as const;

/**
 * 069 (US5) — El rastro de la plataforma: quién, qué, en qué negocio, por qué
 * vía y cuándo. Filtros por organización, acción y vía (por la URL).
 */
export default async function AuditoriaPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; accion?: string; via?: string }>;
}) {
  const f = await searchParams;
  const filtros: SQL[] = [];
  if (f.org) filtros.push(eq(schema.platformAuditLog.organizationId, f.org));
  if (f.accion) filtros.push(eq(schema.platformAuditLog.action, f.accion));
  if (f.via && (VIAS as readonly string[]).includes(f.via)) {
    filtros.push(eq(schema.platformAuditLog.via, f.via as (typeof VIAS)[number]));
  }
  const [orgs, filas] = await Promise.all([
    listarOrganizaciones(),
    getDb()
      .select({
        id: schema.platformAuditLog.id,
        action: schema.platformAuditLog.action,
        via: schema.platformAuditLog.via,
        organizationId: schema.platformAuditLog.organizationId,
        detail: schema.platformAuditLog.detail,
        ip: schema.platformAuditLog.ip,
        createdAt: schema.platformAuditLog.createdAt,
        actor: schema.user.email,
      })
      .from(schema.platformAuditLog)
      .leftJoin(schema.user, eq(schema.user.id, schema.platformAuditLog.actorUserId))
      .where(filtros.length ? and(...filtros) : undefined)
      .orderBy(desc(schema.platformAuditLog.createdAt))
      .limit(200),
  ]);
  const nombre = new Map(orgs.map((o) => [o.id, o.name]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Auditoría</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form className="flex flex-wrap gap-2 text-sm" method="get">
          <select name="org" defaultValue={f.org ?? ""} className="h-9 rounded-md border bg-background px-2">
            <option value="">Todos los negocios</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <input
            name="accion"
            defaultValue={f.accion ?? ""}
            placeholder="acción (p. ej. soporte_peticion)"
            className="h-9 rounded-md border bg-background px-2"
          />
          <select name="via" defaultValue={f.via ?? ""} className="h-9 rounded-md border bg-background px-2">
            <option value="">Toda vía</option>
            {VIAS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <button type="submit" className="h-9 rounded-md bg-brand px-3 text-brand-fg">
            Filtrar
          </button>
        </form>
        {filas.length === 0 ? (
          <p className="text-sm text-text-3">Sin entradas.</p>
        ) : (
          <ul className="divide-y text-sm">
            {filas.map((e) => (
              <li key={e.id} className="py-2">
                <p>
                  <span className="font-mono text-xs">{e.action}</span>
                  {e.organizationId && <span className="text-text-2"> · {nombre.get(e.organizationId) ?? e.organizationId}</span>}
                </p>
                <p className="text-xs text-text-3">
                  {e.actor ?? "—"} · {e.via} · {e.createdAt.toISOString().replace("T", " ").slice(0, 19)} UTC
                  {e.ip ? ` · ${e.ip}` : ""}
                </p>
                <p className="break-all font-mono text-[11px] text-text-3">{JSON.stringify(e.detail)}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
