"use client";

import { useEffect, useState } from "react";
import { Braces, Check, Copy, LayoutDashboard, Loader2, Mail, Settings2, type LucideIcon } from "lucide-react";
import { leerErrorPlataforma } from "@/components/plataforma/errores";
import { FormularioBlueprint, type PropsFormulario } from "@/components/plataforma/formulario/formulario-blueprint";
import type { OrganizationBlueprint } from "@/lib/platform/blueprint";
import { cn } from "@/lib/utils";

/**
 * Auditoría 069 (Fix-C/D) — La ficha de un negocio en pestañas: resumen y
 * equipo, configurar (el FormularioBlueprint precargado), invitaciones y el
 * Blueprint en JSON. Lo de servidor llega ya dibujado por props.
 */

const PESTANAS: { id: string; titulo: string; icono: LucideIcon }[] = [
  { id: "resumen", titulo: "Resumen y equipo", icono: LayoutDashboard },
  { id: "configurar", titulo: "Configurar", icono: Settings2 },
  { id: "invitaciones", titulo: "Invitaciones", icono: Mail },
  { id: "json", titulo: "JSON", icono: Braces },
];

export function FichaOrganizacion({
  resumen,
  invitaciones,
  json,
  formulario,
  pendientes,
}: {
  resumen: React.ReactNode;
  invitaciones: React.ReactNode;
  json: React.ReactNode;
  formulario: Omit<PropsFormulario, "modo" | "inicial"> & { organizationId: string };
  pendientes: number;
}) {
  const [pestana, setPestana] = useState("resumen");
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Ficha del negocio" className="flex gap-1 overflow-x-auto border-b">
        {PESTANAS.map((t) => {
          const Icono = t.icono;
          const activa = pestana === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={activa}
              onClick={() => setPestana(t.id)}
              className={cn(
                "-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
                activa ? "border-brand font-medium text-foreground" : "border-transparent text-text-3 hover:text-foreground"
              )}
            >
              <Icono className="h-4 w-4" strokeWidth={1.8} />
              {t.titulo}
              {t.id === "invitaciones" && pendientes > 0 && (
                <span className="rounded-full bg-subtle px-1.5 text-[11px] tabular-nums text-text-2">{pendientes}</span>
              )}
            </button>
          );
        })}
      </div>
      <div role="tabpanel">
        {pestana === "resumen" && resumen}
        {pestana === "configurar" && <ConfigurarNegocio {...formulario} />}
        {pestana === "invitaciones" && invitaciones}
        {pestana === "json" && json}
      </div>
    </div>
  );
}

/**
 * Carga el Blueprint vigente al abrir la pestaña (por la API: la lectura
 * queda auditada como `blueprint_exportado`) y abre el formulario con él.
 */
function ConfigurarNegocio(p: Omit<PropsFormulario, "modo" | "inicial"> & { organizationId: string }) {
  const [bp, setBp] = useState<OrganizationBlueprint | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    fetch(`/api/platform/organizations/${p.organizationId}/blueprint`)
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as unknown;
        if (!vivo) return;
        if (!res.ok) setError(leerErrorPlataforma(data));
        else setBp(data as OrganizationBlueprint);
      })
      .catch(() => vivo && setError("No se pudo cargar la configuración."));
    return () => {
      vivo = false;
    };
  }, [p.organizationId]);

  if (error) return <p className="rounded-md border border-danger-soft bg-danger-tint p-3 text-sm text-danger-text">{error}</p>;
  if (!bp)
    return (
      <p className="flex items-center gap-2 p-6 text-sm text-text-3">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando la configuración…
      </p>
    );
  return <FormularioBlueprint modo="editar" inicial={bp} {...p} />;
}

/** El subdominio con botón de copiar. */
export function CopiarDireccion({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      title="Copiar la dirección"
      onClick={async () => {
        await navigator.clipboard.writeText(texto).catch(() => undefined);
        setCopiado(true);
        setTimeout(() => setCopiado(false), 1500);
      }}
      className="inline-flex max-w-full items-center gap-1.5 rounded-md px-1 font-mono text-xs text-text-3 hover:bg-subtle hover:text-foreground"
    >
      <span className="truncate">{texto}</span>
      {copiado ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}
