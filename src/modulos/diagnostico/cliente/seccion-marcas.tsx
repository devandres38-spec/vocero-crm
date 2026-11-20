"use client";

import { useEffect, useState } from "react";
import type { MarcasDeConversacion } from "../consultas";

/**
 * 072-B — Sección «Diagnóstico» de la ficha lateral: cuántas marcas dejó el
 * cerebro en esta conversación. Se carga con `next/dynamic` solo en negocios
 * con el módulo (`src/modulos/registro-cliente.ts`).
 */
export default function SeccionMarcas({ conversationId }: { conversationId: string }) {
  const [datos, setDatos] = useState<MarcasDeConversacion | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let vivo = true;
    setDatos(null);
    setError(false);
    fetch(`/api/m/diagnostico/marcas?conversationId=${encodeURIComponent(conversationId)}`)
      .then((r) => (r.ok ? (r.json() as Promise<MarcasDeConversacion>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => vivo && setDatos(d))
      .catch(() => vivo && setError(true));
    return () => {
      vivo = false;
    };
  }, [conversationId]);

  if (error) return <p className="text-xs text-text-3">No se pudo leer el diagnóstico.</p>;
  if (!datos) return <p className="text-xs text-text-3">Cargando…</p>;
  return (
    <p className="text-sm text-text-2">
      {datos.total === 0
        ? "El cerebro no ha dejado marcas en esta conversación."
        : `${datos.total} marca${datos.total === 1 ? "" : "s"} del cerebro en esta conversación.`}
    </p>
  );
}
