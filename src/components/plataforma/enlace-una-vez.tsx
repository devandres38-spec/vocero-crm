"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { COPIA_MANUAL, copiarAlPortapapeles } from "@/lib/clipboard";

/**
 * 069 — Un enlace que solo se puede ver AHORA: en la base solo queda su hash.
 * Se dice claramente, para que nadie cierre la pantalla sin copiarlo.
 */
export function EnlaceUnaVez({ url, expiresAt }: { url: string; expiresAt?: string }) {
  const [copiado, setCopiado] = useState<boolean | null>(null);
  return (
    <div className="space-y-2 rounded-md border border-warning-soft bg-warning-tint p-3">
      <p className="text-sm font-medium text-warning-text">
        Copia este enlace ahora: no se puede volver a mostrar.
      </p>
      <code className="block break-all rounded bg-background p-2 font-mono text-xs">{url}</code>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          onClick={async () => setCopiado(await copiarAlPortapapeles(url))}
        >
          {copiado ? "Copiado" : "Copiar enlace"}
        </Button>
        {copiado === false && <span className="text-xs text-danger-text">{COPIA_MANUAL}</span>}
        {expiresAt && (
          <span className="text-xs text-text-3">
            Vence: {new Date(expiresAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
          </span>
        )}
      </div>
    </div>
  );
}
