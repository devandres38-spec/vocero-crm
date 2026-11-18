"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { leerErrorPlataforma } from "@/components/plataforma/errores";
import { SELECT } from "@/components/plataforma/formulario/controles";
import { cn } from "@/lib/utils";

/**
 * Auditoría 069 (Fix-D) — El rastro de la plataforma, sobre
 * `GET /api/platform/audit` (la misma consulta que `list_audit_log` del MCP):
 * filtros, hora local del navegador, vía con color, detalle plegable y
 * «Cargar más» por cursor.
 */

type Entrada = {
  id: string;
  action: string;
  via: string;
  organizationId: string | null;
  actor: string | null;
  tokenId: string | null;
  detail: unknown;
  ip: string | null;
  createdAt: string;
};

export const NOMBRE_ACCION: Record<string, string> = {
  admin_registrado: "Super-Admin registrado",
  organizacion_creada: "Negocio creado",
  organizacion_suspendida: "Negocio suspendido",
  organizacion_reactivada: "Negocio reactivado",
  modulos_cambiados: "Módulos cambiados",
  invitacion_creada: "Invitación creada",
  invitacion_revocada: "Invitación revocada",
  invitacion_aceptada: "Invitación aceptada",
  blueprint_aplicado: "Blueprint aplicado",
  blueprint_exportado: "Blueprint leído",
  icono_cambiado: "Logo cambiado",
  token_creado: "Token creado",
  token_revocado: "Token revocado",
  token_rechazado: "Token rechazado",
  soporte_otorgado: "Soporte abierto",
  soporte_revocado: "Soporte cerrado",
  soporte_peticion: "Petición con soporte",
  acceso_denegado: "Acceso denegado",
};

const VIA: Record<string, { texto: string; clase: string }> = {
  sesion: { texto: "Panel", clase: "bg-info-tint text-info-text" },
  api: { texto: "API", clase: "bg-success-tint text-success-text" },
  mcp: { texto: "MCP", clase: "bg-brand-tint text-brand-ink" },
};

const LIMITE = 50;

export function VisorAuditoria({
  organizaciones,
  acciones,
}: {
  organizaciones: { id: string; name: string }[];
  acciones: string[];
}) {
  const [org, setOrg] = useState("");
  const [accion, setAccion] = useState("");
  const [via, setVia] = useState("");
  const [entradas, setEntradas] = useState<Entrada[]>([]);
  const [siguiente, setSiguiente] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nombre = new Map(organizaciones.map((o) => [o.id, o.name]));

  const cargar = useCallback(
    async (antes: string | null) => {
      setCargando(true);
      setError(null);
      try {
        const q = new URLSearchParams({ limit: String(LIMITE) });
        if (org) q.set("org", org);
        if (accion) q.set("action", accion);
        if (via) q.set("via", via);
        if (antes) q.set("before", antes);
        const res = await fetch(`/api/platform/audit?${q}`);
        const data = (await res.json().catch(() => null)) as { entries?: Entrada[]; nextBefore?: string | null } | null;
        if (!res.ok || !data?.entries) {
          setError(leerErrorPlataforma(data));
          return;
        }
        setEntradas((xs) => (antes ? [...xs, ...data.entries!] : data.entries!));
        setSiguiente(data.nextBefore ?? null);
      } finally {
        setCargando(false);
      }
    },
    [org, accion, via]
  );

  useEffect(() => {
    void cargar(null);
  }, [cargar]);

  return (
    <div className="rounded-xl border bg-background">
      <div className="grid gap-2 border-b p-3 sm:grid-cols-[1fr_1fr_160px_auto]">
        <select aria-label="Negocio" className={SELECT} value={org} onChange={(e) => setOrg(e.target.value)}>
          <option value="">Todos los negocios</option>
          {organizaciones.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <select aria-label="Acción" className={SELECT} value={accion} onChange={(e) => setAccion(e.target.value)}>
          <option value="">Todas las acciones</option>
          {acciones.map((a) => (
            <option key={a} value={a}>
              {NOMBRE_ACCION[a] ?? a}
            </option>
          ))}
        </select>
        <select aria-label="Vía" className={SELECT} value={via} onChange={(e) => setVia(e.target.value)}>
          <option value="">Toda vía</option>
          {Object.entries(VIA).map(([k, v]) => (
            <option key={k} value={k}>
              {v.texto}
            </option>
          ))}
        </select>
        <Button type="button" variant="outline" disabled={cargando} onClick={() => void cargar(null)} aria-label="Actualizar">
          <RefreshCw className={cn("h-4 w-4", cargando && "animate-spin")} />
        </Button>
      </div>

      {error && <p className="m-3 rounded-md border border-danger-soft bg-danger-tint p-3 text-sm text-danger-text">{error}</p>}

      {entradas.length === 0 && !cargando ? (
        <p className="p-8 text-center text-sm text-text-3">Sin entradas.</p>
      ) : (
        <ul className="divide-y">
          {entradas.map((e) => {
            const v = VIA[e.via] ?? { texto: e.via, clase: "bg-subtle text-text-3" };
            const fecha = new Date(e.createdAt);
            return (
              <li key={e.id} className="px-3 py-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-medium", v.clase)}>{v.texto}</span>
                  <span className="font-medium">{NOMBRE_ACCION[e.action] ?? e.action}</span>
                  {e.organizationId && <span className="text-text-2">· {nombre.get(e.organizationId) ?? e.organizationId}</span>}
                  <time
                    dateTime={e.createdAt}
                    title={e.createdAt}
                    className="ml-auto text-xs tabular-nums text-text-3"
                  >
                    {fecha.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" })}
                  </time>
                </div>
                <details className="group mt-1">
                  <summary className="cursor-pointer list-none text-xs text-text-3 hover:text-foreground">
                    {e.actor ?? "—"}
                    {e.tokenId ? ` · token ${e.tokenId}` : ""}
                    {e.ip ? ` · ${e.ip}` : ""} · <span className="underline underline-offset-2 group-open:hidden">ver detalle</span>
                    <span className="hidden underline underline-offset-2 group-open:inline">ocultar</span>
                  </summary>
                  <pre className="mt-2 overflow-x-auto rounded-md bg-subtle p-2 font-mono text-[11px]">{JSON.stringify(e.detail, null, 2)}</pre>
                </details>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center justify-center border-t p-3">
        {cargando ? (
          <Loader2 className="h-4 w-4 animate-spin text-text-3" />
        ) : siguiente ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void cargar(siguiente)}>
            Cargar más
          </Button>
        ) : (
          entradas.length > 0 && <span className="text-xs text-text-3">No hay más entradas.</span>
        )}
      </div>
    </div>
  );
}
