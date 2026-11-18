"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, LifeBuoy, Megaphone, Search, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { EstadoBadge } from "@/components/plataforma/estado-badge";
import { resolveAccentSet } from "@/lib/branding";
import type { RaizPlataforma } from "@/lib/tenancy";
import { BotonEntrarNegocio } from "@/components/plataforma/boton-entrar-negocio";
import { Pastillas } from "./formulario/controles";

/** Auditoría 069 (Fix-D) — El directorio de negocios: buscar, filtrar y entrar. */

export type NegocioDirectorio = {
  id: string;
  slug: string | null;
  name: string;
  status: "activa" | "suspendida";
  miembros: number;
  accent: string;
  country: string | null;
  currency: string;
  agenda: boolean;
  atribucion: boolean;
  canales: string[];
  soporteVigente: boolean;
  /** ¿Quien mira puede entrar ya (miembro o SU soporte vigente)? */
  acceso: boolean;
};

type Filtro = "todos" | "activa" | "suspendida";

/** Pura: los negocios que coinciden con la búsqueda (nombre o slug, sin acentos) y el filtro. */
export function filtrarNegocios(xs: NegocioDirectorio[], q: string, filtro: Filtro): NegocioDirectorio[] {
  const plegar = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const consulta = plegar(q.trim());
  return xs.filter(
    (o) =>
      (filtro === "todos" || o.status === filtro) &&
      (!consulta || plegar(o.name).includes(consulta) || plegar(o.slug ?? "").includes(consulta))
  );
}

export function DirectorioNegocios({ negocios, raiz }: { negocios: NegocioDirectorio[]; raiz: RaizPlataforma | null }) {
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const visibles = useMemo(() => filtrarNegocios(negocios, q, filtro), [negocios, q, filtro]);

  return (
    <div className="rounded-xl border bg-background">
      <div className="flex flex-wrap items-center gap-3 border-b p-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-text-3" />
          <Input aria-label="Buscar negocio" placeholder="Buscar por nombre o dirección…" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Pastillas
          etiqueta="Estado"
          valor={filtro}
          onChange={setFiltro}
          opciones={[
            { value: "todos", label: "Todos" },
            { value: "activa", label: "Activos" },
            { value: "suspendida", label: "Suspendidos" },
          ]}
        />
      </div>
      {visibles.length === 0 ? (
        <p className="p-8 text-center text-sm text-text-3">
          {negocios.length === 0 ? "Aún no hay negocios. Crea el primero." : "Ningún negocio coincide."}
        </p>
      ) : (
        <ul className="divide-y">
          {visibles.map((o) => {
            const set = resolveAccentSet(o.accent);
            return (
              <li key={o.id} className="flex flex-wrap items-center gap-3 px-3 py-3 transition-colors hover:bg-row-hover sm:flex-nowrap">
                <span
                  aria-hidden
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold"
                  style={{ background: set.accent, color: set.fg }}
                >
                  {o.name.trim().charAt(0).toUpperCase() || "?"}
                </span>
                <div className="min-w-0 flex-1">
                  <Link href={`/platform/organizaciones/${o.id}`} className="block truncate font-medium hover:underline">
                    {o.name}
                  </Link>
                  <p className="truncate font-mono text-xs text-text-3">
                    {o.slug && raiz ? `${o.slug}.${raiz.host}` : (o.slug ?? o.id)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-text-2">
                  <span className="rounded-md bg-subtle px-1.5 py-0.5 font-medium">
                    {o.country ?? "—"} · {o.currency}
                  </span>
                  {o.agenda && (
                    <span title="Agenda" className="inline-flex items-center gap-1 rounded-md bg-subtle px-1.5 py-0.5">
                      <CalendarDays className="h-3 w-3" /> Agenda
                    </span>
                  )}
                  {o.atribucion && (
                    <span title="Atribución" className="inline-flex items-center gap-1 rounded-md bg-subtle px-1.5 py-0.5">
                      <Megaphone className="h-3 w-3" /> Anuncios
                    </span>
                  )}
                  {o.canales.length > 1 && <span className="rounded-md bg-subtle px-1.5 py-0.5">+{o.canales.length - 1} canales</span>}
                  <span className="inline-flex items-center gap-1 rounded-md bg-subtle px-1.5 py-0.5">
                    <Users className="h-3 w-3" /> {o.miembros}
                  </span>
                  {o.soporteVigente && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-warning-tint px-1.5 py-0.5 text-warning-text">
                      <LifeBuoy className="h-3 w-3" /> Soporte
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <EstadoBadge status={o.status} />
                  {raiz && o.slug && o.status === "activa" && (
                    <BotonEntrarNegocio organizationId={o.id} acceso={o.acceso} compacto />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
