"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * 076 — Cambiar la propia contraseña (mínimo 12 caracteres). Al terminar se
 * cierran las demás sesiones; esta sigue abierta.
 */
export function CambiarContrasena({ alTerminar }: { alTerminar: string }) {
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetida, setRepetida] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (nueva !== repetida) return setError("Las dos contraseñas nuevas no coinciden");
    if (nueva.length < 12) return setError("La contraseña nueva debe tener al menos 12 caracteres");
    setEnviando(true);
    const r = await fetch("/api/cuenta/contrasena", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actual, nueva }),
    });
    setEnviando(false);
    if (!r.ok) {
      const d = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
      return setError(d?.error?.message ?? "No se pudo cambiar la contraseña");
    }
    setActual("");
    setNueva("");
    setRepetida("");
    setListo(true);
  }

  if (listo) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-text-2">Listo: tu contraseña cambió y tus otras sesiones se cerraron.</p>
        <a
          href={alTerminar}
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground"
        >
          Seguir
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="max-w-sm space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="actual">Contraseña actual</Label>
        <Input
          id="actual"
          type="password"
          autoComplete="current-password"
          required
          value={actual}
          onChange={(e) => setActual(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="nueva">Contraseña nueva</Label>
        <Input
          id="nueva"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          value={nueva}
          onChange={(e) => setNueva(e.target.value)}
        />
        <p className="text-xs text-text-3">Al menos 12 caracteres. Una frase larga es más fácil de recordar.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="repetida">Repite la contraseña nueva</Label>
        <Input
          id="repetida"
          type="password"
          autoComplete="new-password"
          required
          value={repetida}
          onChange={(e) => setRepetida(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={enviando}>
        {enviando ? "Guardando…" : "Cambiar contraseña"}
      </Button>
    </form>
  );
}
