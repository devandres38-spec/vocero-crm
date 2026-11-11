"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { dolares, fechaCorta, numero, tonoDelGasto } from "./formato";
import { BarraDeGasto } from "./piezas";

/**
 * 076 — La tabla de negocios del panel: solo conteos y banderas. En celular,
 * una tarjeta por negocio. El gasto llega del cerebro (puede faltar).
 */
export type FilaDeNegocio = {
  id: string;
  nombre: string;
  pausadoEn: string | null;
  agenteEncendido: boolean;
  canales: { whatsapp: boolean; instagram: boolean; messenger: boolean; tiktok: boolean };
  usuarios: number;
  conversaciones: number;
  entrantes24h: number;
  creadoEn: string;
  gasto: { hoyUsd: number; topeUsd: number | null } | null;
};

const CANALES: { clave: keyof FilaDeNegocio["canales"]; corto: string; nombre: string }[] = [
  { clave: "whatsapp", corto: "WA", nombre: "WhatsApp" },
  { clave: "instagram", corto: "IG", nombre: "Instagram" },
  { clave: "messenger", corto: "MS", nombre: "Messenger" },
  { clave: "tiktok", corto: "TT", nombre: "TikTok" },
];

function Canales({ canales }: { canales: FilaDeNegocio["canales"] }) {
  const conectados = CANALES.filter((c) => canales[c.clave]);
  if (conectados.length === 0) return <span className="text-text-3">Ninguno</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {conectados.map((c) => (
        <span
          key={c.clave}
          title={c.nombre}
          className="rounded-sm bg-accent px-1.5 py-0.5 font-mono text-[11px] font-semibold"
        >
          {c.corto}
        </span>
      ))}
    </span>
  );
}

function Estado({ fila }: { fila: FilaDeNegocio }) {
  return fila.pausadoEn ? <Badge variant="destructive">Pausado</Badge> : <Badge variant="success">Activo</Badge>;
}

function Gasto({ gasto }: { gasto: FilaDeNegocio["gasto"] }) {
  if (!gasto) return <span className="text-text-3">—</span>;
  if (gasto.topeUsd === null) return <span className="text-text-3">{dolares(gasto.hoyUsd)} · sin tope</span>;
  const p = (gasto.hoyUsd / gasto.topeUsd) * 100;
  return (
    <span className="block min-w-28">
      <span className="text-xs tabular-nums">
        {dolares(gasto.hoyUsd)} / {dolares(gasto.topeUsd)}
      </span>
      <BarraDeGasto porcentaje={p} tono={tonoDelGasto(gasto.hoyUsd, gasto.topeUsd)} />
    </span>
  );
}

export function TablaDeNegocios({ filas }: { filas: FilaDeNegocio[] }) {
  const [q, setQ] = useState("");
  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? filas.filter((f) => f.nombre.toLowerCase().includes(t)) : filas;
  }, [q, filas]);

  return (
    <div>
      <label className="relative mb-4 block max-w-sm">
        <span className="sr-only">Buscar negocio</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-3" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre" className="pl-9" />
      </label>

      {visibles.length === 0 && <p className="text-sm text-text-3">No hay negocios con ese nombre.</p>}

      {/* Escritorio */}
      <div className="hidden overflow-x-auto rounded-lg border border-border-strong bg-card shadow-sm md:block">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs uppercase tracking-wide text-text-3">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Negocio</th>
              <th className="px-3 py-2.5 font-semibold">Estado</th>
              <th className="px-3 py-2.5 font-semibold">Agente</th>
              <th className="px-3 py-2.5 font-semibold">Canales</th>
              <th className="px-3 py-2.5 text-right font-semibold">Usuarios</th>
              <th className="px-3 py-2.5 text-right font-semibold">Conversaciones</th>
              <th className="px-3 py-2.5 text-right font-semibold">Entrantes 24 h</th>
              <th className="px-3 py-2.5 font-semibold">Gasto hoy</th>
              <th className="px-4 py-2.5 font-semibold">Alta</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {visibles.map((f) => (
              <tr key={f.id} className="hover:bg-accent/60">
                <td className="px-4 py-2.5 font-semibold">
                  <Link href={`/admin/negocios/${f.id}`} className="hover:underline">
                    {f.nombre}
                  </Link>
                </td>
                <td className="px-3 py-2.5">
                  <Estado fila={f} />
                </td>
                <td className="px-3 py-2.5">{f.agenteEncendido ? "Encendido" : "Apagado"}</td>
                <td className="px-3 py-2.5">
                  <Canales canales={f.canales} />
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{numero(f.usuarios)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{numero(f.conversaciones)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{numero(f.entrantes24h)}</td>
                <td className="px-3 py-2.5">
                  <Gasto gasto={f.gasto} />
                </td>
                <td className="px-4 py-2.5 text-text-3">{fechaCorta(f.creadoEn)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Celular */}
      <ul className="space-y-3 md:hidden">
        {visibles.map((f) => (
          <li key={f.id}>
            <Link
              href={`/admin/negocios/${f.id}`}
              className="block rounded-lg border border-border-strong bg-card p-4 shadow-sm"
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <p className="font-semibold">{f.nombre}</p>
                <Estado fila={f} />
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-text-3">Agente</dt>
                <dd>{f.agenteEncendido ? "Encendido" : "Apagado"}</dd>
                <dt className="text-text-3">Canales</dt>
                <dd>
                  <Canales canales={f.canales} />
                </dd>
                <dt className="text-text-3">Usuarios</dt>
                <dd className="tabular-nums">{numero(f.usuarios)}</dd>
                <dt className="text-text-3">Entrantes 24 h</dt>
                <dd className="tabular-nums">{numero(f.entrantes24h)}</dd>
                <dt className="text-text-3">Gasto hoy</dt>
                <dd>
                  <Gasto gasto={f.gasto} />
                </dd>
              </dl>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
