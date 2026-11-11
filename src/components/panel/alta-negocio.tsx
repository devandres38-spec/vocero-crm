"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ContrasenaUnaVez } from "./contrasena-una-vez";

/**
 * 076 — El alta de un negocio desde el panel. El resultado (contraseña del
 * dueño e id del negocio) se muestra una sola vez.
 */
type Creado = { organizationId: string; nombre: string; correo: string; contrasena: string };

export function AltaDeNegocio() {
  const [nombre, setNombre] = useState("");
  const [duenoNombre, setDuenoNombre] = useState("");
  const [correo, setCorreo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [creado, setCreado] = useState<Creado | null>(null);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;
    setError(null);
    setEnviando(true);
    try {
      const r = await fetch("/api/admin/negocios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, duenoNombre, correo }),
      });
      const datos = (await r.json().catch(() => null)) as (Creado & { error?: { message?: string } }) | null;
      if (!r.ok || !datos) {
        setError(datos?.error?.message ?? "No se pudo crear el negocio");
        return;
      }
      setCreado(datos);
    } finally {
      setEnviando(false);
    }
  }

  if (creado) {
    return (
      <div className="space-y-4">
        <p className="text-sm">
          <span className="font-semibold">{creado.nombre}</span> quedó creado con su dueño{" "}
          <span className="font-semibold">{creado.correo}</span>.
        </p>
        <ContrasenaUnaVez contrasena={creado.contrasena} para={creado.correo} />
        <div className="rounded-md border border-border-strong p-3 text-sm">
          <p className="font-semibold">Id del negocio</p>
          <code className="break-all font-mono text-xs" data-organizacion>
            {creado.organizationId}
          </code>
          <p className="mt-1 text-xs text-text-3">
            Lo piden <code>cliente:sembrar</code> del cerebro, <code>meta:secreto</code> y{" "}
            <code>privacidad:sembrar</code>.
          </p>
        </div>
        <Link href={`/admin/negocios/${creado.organizationId}`} className="inline-block text-sm font-semibold text-brand-ink">
          Ver el negocio →
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={crear} className="max-w-md space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="nombre">Nombre del negocio</Label>
        <Input id="nombre" required minLength={2} maxLength={120} value={nombre} onChange={(e) => setNombre(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="dueno">Nombre del dueño</Label>
        <Input id="dueno" required maxLength={120} value={duenoNombre} onChange={(e) => setDuenoNombre(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="correo">Correo del dueño</Label>
        <Input
          id="correo"
          type="email"
          required
          maxLength={254}
          value={correo}
          onChange={(e) => setCorreo(e.target.value)}
        />
        <p className="text-xs text-text-3">Un correo pertenece a un solo negocio.</p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={enviando}>
        {enviando ? "Creando…" : "Crear negocio"}
      </Button>
    </form>
  );
}
