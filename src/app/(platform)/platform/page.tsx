import Link from "next/link";
import { Building2, CircleCheck, CirclePause, LifeBuoy, Plus, type LucideIcon } from "lucide-react";
import { raizPlataforma } from "@/lib/tenancy";
import { DirectorioNegocios } from "@/components/plataforma/directorio-negocios";
import { EncabezadoPagina } from "@/components/plataforma/shell-plataforma";
import { listarOrganizaciones } from "@/server/platform/organizaciones";
import { listarAccesos } from "@/server/platform/soporte";
import { requirePlataformaPagina } from "@/server/platform/guardia";
import { negociosConAcceso } from "@/server/platform/pase";

export const dynamic = "force-dynamic";

/**
 * 069 (US2) — Los negocios de la plataforma. Solo configuración y conteos:
 * nada de conversaciones ni contactos. Auditoría 069 (Fix-D): indicadores,
 * búsqueda, filtro y avatares con el color de cada marca.
 */
export default async function PlatformHome() {
  const actor = await requirePlataformaPagina();
  const [orgs, accesos, puede] = await Promise.all([listarOrganizaciones(), listarAccesos(200), negociosConAcceso(actor.userId)]);
  const conSoporte = new Set(accesos.filter((a) => a.vigente).map((a) => a.organizationId));
  const activos = orgs.filter((o) => o.status === "activa").length;

  return (
    <>
      <EncabezadoPagina
        titulo="Negocios"
        descripcion="Los negocios de la plataforma. Para ver sus conversaciones hace falta un acceso de soporte."
        accion={
          <Link href="/platform/nuevo" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand px-4 text-sm font-medium text-brand-fg hover:bg-brand-hover">
            <Plus className="h-4 w-4" /> Nuevo negocio
          </Link>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi titulo="Total" valor={orgs.length} icono={Building2} />
        <Kpi titulo="Activos" valor={activos} icono={CircleCheck} tono="success" />
        <Kpi titulo="Suspendidos" valor={orgs.length - activos} icono={CirclePause} tono="danger" />
        <Kpi titulo="Soportes vigentes" valor={conSoporte.size} icono={LifeBuoy} tono="warning" />
      </div>
      <DirectorioNegocios
        raiz={raizPlataforma()}
        negocios={orgs.map((o) => ({
          id: o.id,
          slug: o.slug,
          name: o.name,
          status: o.status,
          miembros: o.miembros,
          accent: o.accent,
          country: o.country,
          currency: o.currency,
          agenda: o.modulos.agenda,
          atribucion: o.modulos.atribucion,
          canales: o.modulos.channels,
          soporteVigente: conSoporte.has(o.id),
          acceso: puede.has(o.id),
        }))}
      />
    </>
  );
}

const TONOS = {
  brand: "bg-brand-tint text-brand-ink",
  success: "bg-success-tint text-success-text",
  danger: "bg-danger-tint text-danger-text",
  warning: "bg-warning-tint text-warning-text",
} as const;

function Kpi({ titulo, valor, icono: Icono, tono = "brand" }: { titulo: string; valor: number; icono: LucideIcon; tono?: keyof typeof TONOS }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-background p-4">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${TONOS[tono]}`}>
        <Icono className="h-5 w-5" strokeWidth={1.8} />
      </span>
      <div>
        <p className="text-2xl font-semibold leading-none tabular-nums">{valor}</p>
        <p className="mt-1 text-xs text-text-3">{titulo}</p>
      </div>
    </div>
  );
}
