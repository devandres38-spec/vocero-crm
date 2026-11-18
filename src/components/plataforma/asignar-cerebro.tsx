"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { leerErrorPlataforma } from "@/components/plataforma/errores";
import { SELECT } from "@/components/plataforma/formulario/controles";

/**
 * 070 (US2) — Qué cerebro atiende a este negocio. Sin cerebro, el negocio
 * opera su bandeja a mano. Solo se ofrecen despliegues activos; el actual se
 * muestra aunque esté pausado, para que se vea por qué no contesta.
 */
export function AsignarCerebro({
  organizationId,
  actual,
  opciones,
}: {
  organizationId: string;
  actual: { id: string; name: string; status: "activo" | "pausado" } | null;
  opciones: { id: string; name: string; status: "activo" | "pausado" }[];
}) {
  const router = useRouter();
  const [valor, setValor] = useState(actual?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [guardado, setGuardado] = useState(false);

  const visibles = opciones.filter((o) => o.status === "activo" || o.id === actual?.id);

  async function guardar() {
    setError(null);
    setGuardado(false);
    setOcupado(true);
    try {
      const res = await fetch(`/api/platform/organizations/${encodeURIComponent(organizationId)}/brain`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deployment: valor || null }),
      });
      const data = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) {
        setError(leerErrorPlataforma(data));
        return;
      }
      setGuardado(true);
      router.refresh();
    } finally {
      setOcupado(false);
    }
  }

  if (opciones.length === 0) {
    return (
      <p className="text-sm text-text-3">
        No hay cerebros registrados. Registra uno en{" "}
        <Link href="/platform/cerebros" className="text-brand underline-offset-2 hover:underline">
          Cerebros
        </Link>
        ; mientras tanto, este negocio atiende su bandeja a mano.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Cerebro asignado"
          className={`${SELECT} max-w-xs`}
          value={valor}
          onChange={(e) => {
            setValor(e.target.value);
            setGuardado(false);
          }}
        >
          <option value="">Sin cerebro (bandeja manual)</option>
          {visibles.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
              {o.status === "pausado" ? " (pausado)" : ""}
            </option>
          ))}
        </select>
        <Button size="sm" type="button" disabled={ocupado || valor === (actual?.id ?? "")} onClick={guardar}>
          Guardar
        </Button>
        {guardado && <span className="text-xs text-success-text">Guardado</span>}
      </div>
      <p className="text-xs text-text-3">
        Contesta solo si el negocio además tiene el agente encendido y su llave de IA en Ajustes → IA.
      </p>
      {error && (
        <p role="alert" className="text-sm text-danger-text">
          {error}
        </p>
      )}
    </div>
  );
}
