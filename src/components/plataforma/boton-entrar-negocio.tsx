"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink, LifeBuoy, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 069 (staging) — Entrar a un negocio desde la raíz. Con membresía o soporte
 * vigente, pide un pase de un solo uso y abre el subdominio ya con sesión.
 * Sin acceso, no manda a ciegas al subdominio (rebotaría en «no
 * perteneces»): lleva a `/platform/soporte?org=…` para abrir uno.
 */
export function BotonEntrarNegocio({
  organizationId,
  acceso,
  etiqueta = "Abrir negocio",
  compacto = false,
  className,
}: {
  organizationId: string;
  /** ¿Ya puede entrar (miembro o soporte vigente)? Lo decide el servidor. */
  acceso: boolean;
  etiqueta?: string;
  /** Solo el icono (filas del directorio). */
  compacto?: boolean;
  className?: string;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const estilo = cn(
    compacto
      ? "inline-flex h-8 w-8 items-center justify-center rounded-md text-text-3 hover:bg-subtle hover:text-foreground"
      : "inline-flex h-8 items-center gap-1.5 rounded-md border border-border-strong px-3 text-xs font-medium hover:border-foreground",
    className
  );

  if (!acceso) {
    return (
      <Link href={`/platform/soporte?org=${organizationId}`} className={estilo} title="Entrar con soporte" aria-label="Entrar con soporte">
        <LifeBuoy className="h-4 w-4" />
        {!compacto && "Entrar con soporte"}
      </Link>
    );
  }

  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        disabled={ocupado}
        title={etiqueta}
        aria-label={etiqueta}
        className={estilo}
        onClick={async () => {
          setOcupado(true);
          setError(null);
          try {
            const res = await fetch("/api/pase", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ organizationId }),
            });
            const data = (await res.json().catch(() => null)) as { url?: string } | null;
            if (!res.ok || !data?.url) {
              setError(res.status === 403 ? "Tu acceso ya no está vigente." : "No se pudo abrir el negocio.");
              return;
            }
            window.location.href = data.url;
          } finally {
            setOcupado(false);
          }
        }}
      >
        {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
        {!compacto && etiqueta}
      </button>
      {error && <span className="mt-1 text-[11px] text-danger-text">{error}</span>}
    </span>
  );
}
