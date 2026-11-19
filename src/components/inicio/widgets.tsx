import Link from "next/link";
import { CalendarDays, Inbox, Kanban, LayoutDashboard, PartyPopper, Users, type LucideIcon } from "lucide-react";
import { formatDate, formatTime } from "@/lib/region";
import { urlDeConversacion } from "@/lib/avisos-sistema";
import { t, type Vocabulario } from "@/verticals/vocabulario";
import type { WidgetRef } from "@/verticals/tipos";
import {
  citasDeHoy,
  leadsPorEtapa,
  proximosPorFecha,
  sinResponder,
  TOPE_LISTA_INICIO,
} from "@/server/inicio/widgets";

/**
 * 072 (FR-005) — Los widgets del Inicio: Server Components async, cada uno con
 * su consulta acotada a la organización. Un widget que falla se pinta como
 * tarjeta de aviso y NO tumba la página: el Inicio es para mirar rápido.
 */

export type ContextoWidget = {
  organizationId: string;
  vocabulario: Vocabulario;
  locale: string;
  timezone: string;
  agenda: boolean;
};

function Tarjeta({
  titulo,
  icono: Icono,
  accion,
  children,
}: {
  titulo: string;
  icono: LucideIcon;
  accion?: { href: string; texto: string };
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-h-[9rem] flex-col rounded-lg border bg-card p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[14px] font-semibold">
          <Icono className="h-4 w-4 text-text-3" aria-hidden />
          {titulo}
        </h2>
        {accion && (
          <Link href={accion.href} className="text-xs text-text-3 hover:text-foreground hover:underline">
            {accion.texto}
          </Link>
        )}
      </header>
      <div className="min-h-0 flex-1 text-sm">{children}</div>
    </section>
  );
}

function Vacio({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-relaxed text-text-3">{children}</p>;
}

async function SinResponderWidget({ ctx }: { ctx: ContextoWidget }) {
  const { total, lista } = await sinResponder(ctx.organizationId);
  return (
    <Tarjeta titulo="Sin responder" icono={Inbox} accion={{ href: "/inbox", texto: `Ir a ${t(ctx.vocabulario, "bandeja")}` }}>
      {total === 0 ? (
        <Vacio>Todo al día: nadie espera respuesta.</Vacio>
      ) : (
        <>
          <p className="mb-2 text-2xl font-bold tabular-nums">{total}</p>
          <ul className="space-y-1">
            {lista.map((c) => (
              <li key={c.conversationId} className="flex items-center justify-between gap-2">
                <Link href={urlDeConversacion(c.conversationId)} className="min-w-0 truncate hover:underline">
                  {c.nombre}
                </Link>
                <span className="shrink-0 text-xs text-text-3 tabular-nums">{c.pendientes}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Tarjeta>
  );
}

async function LeadsPorEtapaWidget({ ctx }: { ctx: ContextoWidget }) {
  const etapas = await leadsPorEtapa(ctx.organizationId);
  const max = Math.max(1, ...etapas.map((e) => e.total));
  return (
    <Tarjeta titulo={t(ctx.vocabulario, "pipeline")} icono={Kanban} accion={{ href: "/pipeline", texto: "Ver tablero" }}>
      {etapas.length === 0 ? (
        <Vacio>Sin etapas abiertas.</Vacio>
      ) : (
        <ul className="space-y-1.5">
          {etapas.map((e) => (
            <li key={e.etapa} className="text-xs">
              <div className="flex justify-between gap-2">
                <span className="truncate">{e.etapa}</span>
                <span className="tabular-nums text-text-3">{e.total}</span>
              </div>
              <div className="mt-0.5 h-1.5 rounded-full bg-muted">
                <div className="h-1.5 rounded-full bg-primary" style={{ width: `${(e.total / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Tarjeta>
  );
}

async function CitasDeHoyWidget({ ctx }: { ctx: ContextoWidget }) {
  const citas = await citasDeHoy(ctx.organizationId, ctx.timezone);
  const titulo = `${t(ctx.vocabulario, "cita", "varios")} de hoy`;
  return (
    <Tarjeta titulo={titulo} icono={CalendarDays} accion={{ href: "/bookings", texto: "Ver agenda" }}>
      {citas.length === 0 ? (
        <Vacio>No hay {t(ctx.vocabulario, "cita", "varios").toLowerCase()} para hoy.</Vacio>
      ) : (
        <ul className="space-y-1">
          {citas.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">{c.nombre ?? "—"}</span>
              <span className="shrink-0 text-xs tabular-nums text-text-3">
                {formatTime(c.hora, ctx.locale, { hour: "2-digit", minute: "2-digit", timeZone: ctx.timezone })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Tarjeta>
  );
}

async function ProximosWidget({ ctx, campo, titulo }: { ctx: ContextoWidget; campo: string; titulo?: string }) {
  const proximos = await proximosPorFecha(ctx.organizationId, campo, ctx.timezone);
  return (
    <Tarjeta titulo={titulo ?? "Próximos"} icono={PartyPopper} accion={{ href: "/contacts", texto: `Ver ${t(ctx.vocabulario, "contacto", "varios").toLowerCase()}` }}>
      {proximos.length === 0 ? (
        <Vacio>Nada en los próximos 30 días.</Vacio>
      ) : (
        <ul className="space-y-1">
          {proximos.slice(0, TOPE_LISTA_INICIO).map((p) => (
            <li key={p.contactId} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">{p.nombre}</span>
              <span className="shrink-0 text-xs tabular-nums text-text-3">
                {formatDate(`${p.fecha}T12:00:00Z`, ctx.locale, { day: "numeric", month: "short", timeZone: "UTC" })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Tarjeta>
  );
}

function AccesosRapidos({ ctx }: { ctx: ContextoWidget }) {
  const accesos = [
    { href: "/inbox", texto: t(ctx.vocabulario, "bandeja"), icono: Inbox },
    { href: "/contacts", texto: t(ctx.vocabulario, "contacto", "varios"), icono: Users },
    { href: "/pipeline", texto: t(ctx.vocabulario, "pipeline"), icono: Kanban },
    ...(ctx.agenda ? [{ href: "/bookings", texto: t(ctx.vocabulario, "cita", "varios"), icono: CalendarDays }] : []),
  ];
  return (
    <Tarjeta titulo="Accesos rápidos" icono={LayoutDashboard}>
      <ul className="grid grid-cols-2 gap-2">
        {accesos.map((a) => (
          <li key={a.href}>
            <Link
              href={a.href}
              className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs hover:bg-accent"
            >
              <a.icono className="h-3.5 w-3.5 text-text-3" aria-hidden />
              {a.texto}
            </Link>
          </li>
        ))}
      </ul>
    </Tarjeta>
  );
}

/** Puro: qué widgets se pintan. Sin agenda, `citas_de_hoy` no existe; los de módulo, en 072-B. */
export function widgetsVisibles(widgets: WidgetRef[], agenda: boolean): WidgetRef[] {
  return widgets.filter((w) => {
    if (w.tipo === "citas_de_hoy") return agenda;
    return !w.tipo.includes(".");
  });
}

/** Un widget con su red: si su consulta falla, una tarjeta de aviso y sigue la página. */
export async function Widget({ w, ctx }: { w: WidgetRef; ctx: ContextoWidget }) {
  try {
    switch (w.tipo) {
      case "sin_responder":
        return await SinResponderWidget({ ctx });
      case "leads_por_etapa":
        return await LeadsPorEtapaWidget({ ctx });
      case "citas_de_hoy":
        return await CitasDeHoyWidget({ ctx });
      case "accesos_rapidos":
        return AccesosRapidos({ ctx });
      case "proximos_por_fecha":
        return "params" in w ? await ProximosWidget({ ctx, campo: w.params.campo, titulo: w.params.titulo }) : null;
      default:
        return null;
    }
  } catch (err) {
    console.error(`[inicio] widget ${w.tipo}:`, err instanceof Error ? err.message : err);
    return (
      <Tarjeta titulo="No se pudo cargar" icono={LayoutDashboard}>
        <Vacio>Este resumen no está disponible ahora. Recarga en un momento.</Vacio>
      </Tarjeta>
    );
  }
}
