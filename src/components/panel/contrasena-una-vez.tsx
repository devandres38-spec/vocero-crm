"use client";

import { useState } from "react";
import { Check, Copy, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * 076 — Una contraseña que se muestra UNA sola vez (alta o restablecimiento).
 * Vive solo en la memoria de esta pantalla: al recargar, ya no está.
 */
export function ContrasenaUnaVez({ contrasena, para }: { contrasena: string; para: string }) {
  const [copiada, setCopiada] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(contrasena);
      setCopiada(true);
      setTimeout(() => setCopiada(false), 2000);
    } catch {
      setCopiada(false);
    }
  }
  return (
    <div className="space-y-3 rounded-md border border-warning-soft bg-warning-tint p-4">
      <p className="flex items-start gap-2 text-sm font-semibold text-warning-text">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        La contraseña de {para} no se vuelve a mostrar. Pásasela por un canal privado; tendrá que cambiarla al
        entrar.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded bg-card px-3 py-2 font-mono text-sm" data-contrasena>
          {contrasena}
        </code>
        <Button type="button" variant="outline" className="min-h-11 gap-1.5" onClick={copiar}>
          {copiada ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {copiada ? "Copiada" : "Copiar"}
        </Button>
      </div>
    </div>
  );
}
