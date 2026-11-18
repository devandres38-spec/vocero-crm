import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, LifeBuoy } from "lucide-react";
import { BotonEntrarNegocio } from "@/components/plataforma/boton-entrar-negocio";
import { requirePlataformaPagina } from "@/server/platform/guardia";
import { accesoANegocio, accesoPermiteEntrar } from "@/server/platform/pase";
import { EstadoBadge } from "@/components/plataforma/estado-badge";
import {
  BotonEstado,
  InvitacionesOrganizacion,
} from "@/components/plataforma/acciones-organizacion";
import { EditorBlueprint } from "@/components/plataforma/editor-blueprint";
import {
  CopiarDireccion,
  FichaOrganizacion,
} from "@/components/plataforma/ficha-organizacion";
import { Seccion } from "@/components/plataforma/formulario/controles";
import { resolveAccentSet } from "@/lib/branding";
import { getRegion } from "@/lib/region";
import { dominioBase, raizPlataforma } from "@/lib/tenancy";
import { techoDeInstancia } from "@/server/modulos/efectivos";
import { ETAPAS_POR_DEFECTO } from "@/server/platform/catalogo";
import { detalleOrganizacion } from "@/server/platform/organizaciones";
import { accesosDeOrganizacion } from "@/server/platform/soporte";

export const dynamic = "force-dynamic";

const ROL: Record<string, string> = {
  owner: "Dueño",
  admin: "Administrador",
  member: "Equipo",
};

/**
 * 069 (US2) — La ficha de un negocio para la agencia: configuración, equipo
 * (correo y rol), invitaciones y estado. Ni conversaciones ni contactos: eso
 * solo con acceso de soporte (US5). Auditoría 069 (Fix-C/D): encabezado con
 * acciones rápidas y pestañas; «Configurar» edita el 100% del Blueprint.
 */
export default async function DetalleOrganizacionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requirePlataformaPagina();
  const org = await detalleOrganizacion((await params).id);
  if (!org) notFound();
  // Entrar solo si ya puede (miembro de un negocio activo, o SU soporte
  // vigente, también en uno suspendido — F-03); si no, «Entrar con soporte».
  const puedeEntrar = accesoPermiteEntrar(await accesoANegocio(actor.userId, org.id), org.status);
  const accesos = await accesosDeOrganizacion(org.id, 5);
  const raiz = raizPlataforma();
  const instancia = getRegion();
  const techo = techoDeInstancia();
  const set = resolveAccentSet(org.branding.accent);
  const direccion =
    org.slug && raiz ? `${org.slug}.${raiz.host}` : (org.slug ?? org.id);
  const vigentes = accesos.filter((a) => a.vigente);

  const resumen = (
    <div className="grid gap-4 lg:grid-cols-2">
      <Seccion titulo="Configuración">
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <Dato
            k="País"
            v={org.region.country ?? `${instancia.country} (de la instancia)`}
          />
          <Dato
            k="Idioma y formato"
            v={org.region.locale ?? `${instancia.locale} (de la instancia)`}
          />
          <Dato
            k="Zona horaria"
            v={org.region.timezone ?? `${instancia.timezone} (de la instancia)`}
          />
          <Dato k="Moneda" v={org.branding.currency} />
          <Dato k="Marca" v={org.branding.name} />
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
          <Dato
            k="Alta"
            v={new Date(org.createdAt).toISOString().slice(0, 10)}
          />
        </dl>
      </Seccion>
      <Seccion titulo={`Equipo (${org.equipo.length})`}>
        {org.equipo.length === 0 ? (
          <p className="text-sm text-text-3">
            Nadie ha entrado todavía. Invita al dueño desde «Invitaciones».
          </p>
        ) : (
          <ul className="divide-y text-sm">
            {org.equipo.map((m) => (
              <li
                key={m.email}
                className="flex items-center justify-between gap-2 py-2"
              >
                <span className="min-w-0 truncate">
                  {m.name} <span className="text-text-3">· {m.email}</span>
                </span>
                <span className="shrink-0 rounded-md bg-subtle px-1.5 py-0.5 text-xs text-text-2">
                  {ROL[m.role] ?? m.role}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Seccion>
      <Seccion
        titulo="Accesos de soporte recientes"
        descripcion="El dueño los ve en su pantalla de Equipo."
      >
        {accesos.length === 0 ? (
          <p className="text-sm text-text-3">Ninguno.</p>
        ) : (
          <ul className="divide-y text-sm">
            {accesos.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <span className="min-w-0 truncate">
                  {a.actor}{" "}
                  <span className="text-text-3">
                    · {a.level} · «{a.reason}»
                  </span>
                </span>
                <span
                  className={`rounded-md px-1.5 py-0.5 text-[11px] ${a.vigente ? "bg-warning-tint text-warning-text" : "bg-subtle text-text-3"}`}
                >
                  {a.vigente ? "Vigente" : a.revokedAt ? "Revocado" : "Vencido"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Seccion>
    </div>
  );

  return (
    <div className="space-y-6">
      <Link
        href="/platform"
        className="inline-flex items-center gap-1 text-sm text-text-3 hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Negocios
      </Link>
      <div className="flex flex-wrap items-center gap-4 rounded-xl border bg-background p-4">
        <span
          aria-hidden
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-xl font-bold"
          style={{ background: set.accent, color: set.fg }}
        >
          {org.name.trim().charAt(0).toUpperCase() || "?"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight">
              {org.name}
            </h1>
            <EstadoBadge status={org.status} />
            {vigentes.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning-tint px-2 py-0.5 text-xs text-warning-text">
                <LifeBuoy className="h-3 w-3" /> Soporte vigente
              </span>
            )}
          </div>
          <CopiarDireccion texto={direccion} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {raiz && org.slug && <BotonEntrarNegocio organizationId={org.id} acceso={puedeEntrar} />}
          {puedeEntrar && (
            <Link
              href={`/platform/soporte?org=${org.id}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-strong px-3 text-xs font-medium hover:border-foreground"
            >
              <LifeBuoy className="h-4 w-4" /> Pedir soporte
            </Link>
          )}
          <BotonEstado id={org.id} status={org.status} />
        </div>
      </div>

      <FichaOrganizacion
        resumen={resumen}
        pendientes={org.invitaciones.length}
        invitaciones={
          <InvitacionesOrganizacion
            id={org.id}
            invitaciones={org.invitaciones}
          />
        }
        json={<EditorBlueprint id={org.id} />}
        formulario={{
          organizationId: org.id,
          dominio: dominioBase(),
          defaults: {
            country: instancia.country,
            locale: instancia.locale,
            timezone: instancia.timezone,
            currency: org.branding.currency,
            accent: org.branding.accent,
            etapas: [...ETAPAS_POR_DEFECTO.open],
          },
          techo: {
            agenda: techo.agenda,
            atribucion: techo.atribucion,
            channels: [...techo.channels],
          },
          modulosEfectivos: {
            agenda: org.modulos.agenda,
            atribucion: org.modulos.atribucion,
            channels: [...org.modulos.channels],
          },
        }}
      />
    </div>
  );
}

function Dato({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-text-3">{k}</dt>
      <dd className="font-medium">{v || "—"}</dd>
    </div>
  );
}
