"use client";

import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * 076 — Activar el segundo factor del superadmin: confirmar la contraseña, ver
 * el QR (y el secreto, y los códigos de respaldo) UNA vez, y escribir el
 * primer código. Al terminar, todas las sesiones se cierran: se vuelve a
 * entrar con contraseña y código.
 */
type Activacion = { qr: string; secreto: string; codigosDeRespaldo: string[] };

async function enviar(cuerpo: Record<string, string>): Promise<{ ok: boolean; datos: unknown }> {
  const r = await fetch("/api/admin/segundo-factor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  return { ok: r.ok, datos: await r.json().catch(() => null) };
}

function mensajeDe(datos: unknown, porDefecto: string): string {
  const m = (datos as { error?: { message?: string } } | null)?.error?.message;
  return typeof m === "string" && m ? m : porDefecto;
}

export function ActivarSegundoFactor({ correo }: { correo: string }) {
  const [paso, setPaso] = useState<"contrasena" | "codigo" | "listo">("contrasena");
  const [contrasena, setContrasena] = useState("");
  const [codigo, setCodigo] = useState("");
  const [activacion, setActivacion] = useState<Activacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function iniciar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCargando(true);
    const r = await enviar({ accion: "iniciar", contrasena });
    setCargando(false);
    setContrasena("");
    if (!r.ok) return setError(mensajeDe(r.datos, "No se pudo empezar la activación"));
    setActivacion(r.datos as Activacion);
    setPaso("codigo");
  }

  async function verificar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCargando(true);
    const r = await enviar({ accion: "verificar", codigo });
    setCargando(false);
    if (!r.ok) return setError(mensajeDe(r.datos, "El código no es válido"));
    setActivacion(null);
    setPaso("listo");
  }

  return (
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle>Activa tu segundo factor</CardTitle>
        <p className="text-sm text-text-3">
          El panel de Aliantis pide siempre un código de tu teléfono, además de la contraseña de{" "}
          <span className="font-medium text-text-2">{correo}</span>.
        </p>
      </CardHeader>
      <CardContent>
        {paso === "contrasena" && (
          <form onSubmit={iniciar} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="contrasena">Confirma tu contraseña</Label>
              <Input
                id="contrasena"
                type="password"
                autoComplete="current-password"
                required
                value={contrasena}
                onChange={(e) => setContrasena(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="min-h-11 w-full" disabled={cargando}>
              {cargando ? "Preparando…" : "Continuar"}
            </Button>
          </form>
        )}

        {paso === "codigo" && activacion && (
          <form onSubmit={verificar} className="space-y-5">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-text-2">
              <li>Abre tu app de autenticación (Google Authenticator, 1Password…).</li>
              <li>Escanea este código QR.</li>
              <li>Escribe el código de 6 dígitos que te muestra.</li>
            </ol>
            <div
              className="mx-auto w-48 rounded-md bg-white p-2 [&_svg]:h-auto [&_svg]:w-full"
              // SVG generado en el servidor por `uqr` a partir del otpauth://.
              dangerouslySetInnerHTML={{ __html: activacion.qr }}
              aria-label="Código QR del segundo factor"
              role="img"
            />
            <details className="text-sm">
              <summary className="cursor-pointer text-text-3">¿No puedes escanearlo? Escribe el secreto</summary>
              <code className="mt-2 block break-all rounded bg-subtle p-2 font-mono text-xs">
                {activacion.secreto}
              </code>
            </details>
            <div className="rounded-md border border-border-strong p-3">
              <p className="text-sm font-semibold">Códigos de respaldo</p>
              <p className="mb-2 text-xs text-text-3">
                Guárdalos en un lugar seguro, fuera del teléfono. Cada uno sirve una sola vez si pierdes el
                teléfono. No se vuelven a mostrar.
              </p>
              <ul className="grid grid-cols-2 gap-1 font-mono text-xs">
                {activacion.codigosDeRespaldo.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="codigo">Código de tu app</Label>
              <Input
                id="codigo"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                required
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="min-h-11 w-full" disabled={cargando || codigo.length !== 6}>
              {cargando ? "Verificando…" : "Activar"}
            </Button>
          </form>
        )}

        {paso === "listo" && (
          <div className="space-y-4">
            <p className="text-sm text-text-2">
              Listo: el segundo factor quedó activado y tus sesiones se cerraron. Entra otra vez con tu
              contraseña y el código de tu app.
            </p>
            <a href="/login" className={cn(buttonVariants(), "min-h-11 w-full")}>
              Ir al inicio de sesión
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
