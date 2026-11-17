import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EstadoBadge } from "@/components/plataforma/estado-badge";
import { dominioBase } from "@/lib/tenancy";
import { listarOrganizaciones } from "@/server/platform/organizaciones";

export const dynamic = "force-dynamic";

/** 069 (US2) — Los negocios de la plataforma. Solo configuración y conteos. */
export default async function PlatformHome() {
  const orgs = await listarOrganizaciones();
  const base = dominioBase();
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle>Negocios ({orgs.length})</CardTitle>
        <Link
          href="/platform/nuevo"
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-brand-fg"
        >
          Nuevo negocio
        </Link>
      </CardHeader>
      <CardContent>
        {orgs.length === 0 ? (
          <p className="text-sm text-text-3">Aún no hay negocios. Crea el primero.</p>
        ) : (
          <ul className="divide-y">
            {orgs.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <Link
                    href={`/platform/organizaciones/${o.id}`}
                    className="font-medium hover:underline"
                  >
                    {o.name}
                  </Link>
                  <p className="truncate font-mono text-xs text-text-3">
                    {o.slug && base ? `${o.slug}.${base}` : (o.slug ?? o.id)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">
                    {o.miembros} {o.miembros === 1 ? "persona" : "personas"}
                  </Badge>
                  <EstadoBadge status={o.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
