import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { contextoActual, destinoSinOrganizacion, getSessionOrNull } from "@/lib/auth/session";
import { getRegionDeOrganizacion } from "@/server/region";
import { agendaActiva } from "@/server/modulos/consulta";
import { businessTimezone } from "@/server/analytics/period";
import { experienciaDe } from "@/server/verticals/experiencia";
import { Widget, widgetsVisibles, type ContextoWidget } from "@/components/inicio/widgets";
import { t } from "@/verticals/vocabulario";

export const dynamic = "force-dynamic";

/**
 * 072 (D7, FR-005) — El Inicio del negocio: una página del NÚCLEO que pinta
 * los widgets que elige su Vertical Pack (o la agencia para ese negocio).
 * Sin Inicio en el pack (todos los `default`), esta ruta no existe: 404.
 */
export default async function InicioPage() {
  const session = await getSessionOrNull();
  // B-2 (auditoría 072-A) — Igual que el layout: sin organización no siempre
  // es «a /login» (un Super-Admin va a /platform, un subdominio ajeno a otra parte).
  if (!session) redirect(destinoSinOrganizacion(await contextoActual()));
  const experiencia = await experienciaDe(session.organizationId);
  if (!experiencia.inicio) notFound();

  const agenda = agendaActiva(session);
  const [region, timezone] = await Promise.all([
    getRegionDeOrganizacion(session.organizationId),
    businessTimezone(session.organizationId),
  ]);
  const ctx: ContextoWidget = {
    organizationId: session.organizationId,
    vocabulario: experiencia.vocabulario,
    locale: region.locale,
    timezone,
    agenda,
  };
  const widgets = widgetsVisibles(experiencia.inicio.widgets, agenda);

  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-4 py-3 sm:px-6 sm:py-4">
        <h2 className="text-[17px] font-bold tracking-tight">{t(experiencia.vocabulario, "inicio")}</h2>
      </header>
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {widgets.length === 0 && (
          // M-3 (auditoría 072-A) — Todos sus widgets dependen de algo apagado
          // (p. ej. la agenda): se dice, en vez de una página en blanco.
          <p className="text-sm text-text-2">
            Nada que mostrar aquí todavía: los resúmenes de este Inicio dependen de módulos que este negocio no tiene activos.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {widgets.map((w, i) => (
            <Suspense
              key={`${w.tipo}-${i}`}
              fallback={<div className="h-36 animate-pulse rounded-lg border bg-subtle" aria-label="Cargando" />}
            >
              <Widget w={w} ctx={ctx} />
            </Suspense>
          ))}
        </div>
      </div>
    </div>
  );
}
