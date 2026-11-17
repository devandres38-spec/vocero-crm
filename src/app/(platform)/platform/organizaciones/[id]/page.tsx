import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EstadoBadge } from "@/components/plataforma/estado-badge";
import { AccionesOrganizacion } from "@/components/plataforma/acciones-organizacion";
import { ModulosOrganizacion } from "@/components/plataforma/modulos-organizacion";
import { EditorBlueprint } from "@/components/plataforma/editor-blueprint";
import { techoDeInstancia } from "@/server/modulos/efectivos";
import { dominioBase } from "@/lib/tenancy";
import { getRegion } from "@/lib/region";
import { detalleOrganizacion } from "@/server/platform/organizaciones";

export const dynamic = "force-dynamic";

/**
 * 069 (US2) — Detalle de un negocio para la agencia: configuración, equipo
 * (correo y rol), invitaciones pendientes y estado. Ni conversaciones ni
 * contactos: eso solo con acceso de soporte (US5).
 */
export default async function DetalleOrganizacionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const org = await detalleOrganizacion((await params).id);
  if (!org) notFound();
  const base = dominioBase();
  const instancia = getRegion();
  const techo = techoDeInstancia();
  const region = {
    country: org.region.country ?? `${instancia.country} (de la instancia)`,
    locale: org.region.locale ?? `${instancia.locale} (de la instancia)`,
    timezone: org.region.timezone ?? `${instancia.timezone} (de la instancia)`,
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>{org.name}</CardTitle>
            <p className="font-mono text-xs text-text-3">
              {org.slug && base ? `${org.slug}.${base}` : (org.slug ?? org.id)}
            </p>
          </div>
          <EstadoBadge status={org.status} />
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Dato k="País" v={region.country} />
            <Dato k="Idioma y formato" v={region.locale} />
            <Dato k="Zona horaria" v={region.timezone} />
            <Dato k="Moneda" v={org.branding.currency} />
            <Dato k="Marca" v={`${org.branding.name} · ${org.branding.accent}`} />
            <Dato
              k="Módulos activos"
              v={[
                org.modulos.agenda ? "Agenda" : null,
                org.modulos.atribucion ? "Atribución" : null,
                ...org.modulos.channels,
              ]
                .filter(Boolean)
                .join(", ")}
            />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Equipo ({org.equipo.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {org.equipo.length === 0 ? (
            <p className="text-sm text-text-3">Nadie ha entrado todavía. Invita al dueño del negocio.</p>
          ) : (
            <ul className="divide-y text-sm">
              {org.equipo.map((m) => (
                <li key={m.email} className="flex justify-between gap-2 py-2">
                  <span>
                    {m.name} <span className="text-text-3">· {m.email}</span>
                  </span>
                  <span className="text-text-3">{m.role}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ModulosOrganizacion
        id={org.id}
        techo={{ agenda: techo.agenda, atribucion: techo.atribucion, channels: [...techo.channels] }}
        efectivos={org.modulos}
      />

      <AccionesOrganizacion
        id={org.id}
        status={org.status}
        invitaciones={org.invitaciones}
      />

      <EditorBlueprint id={org.id} />
    </div>
  );
}

function Dato({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2 border-b py-1.5 sm:block sm:border-0">
      <dt className="text-text-3">{k}</dt>
      <dd className="font-medium">{v || "—"}</dd>
    </div>
  );
}
