"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BotonSalir } from "@/components/plataforma/boton-salir";

const MENSAJES: Record<string, string> = {
  invitacion_vencida: "La invitación venció. Pide un enlace nuevo.",
  invitacion_usada: "Esta invitación ya se usó.",
  invitacion_revocada: "Esta invitación ya no es válida.",
  invitacion_inexistente: "El enlace no es válido.",
  otro_correo: "Tu sesión es de otro correo. Cierra sesión y vuelve a abrir el enlace.",
  inicia_sesion: "Ya existe una cuenta con ese correo: inicia sesión para aceptar.",
  datos_requeridos: "Escribe tu nombre y una contraseña.",
  registro_fallido: "No se pudo crear la cuenta. Revisa la contraseña (mínimo 8 caracteres).",
  rate_limited: "Demasiados intentos. Espera unos minutos.",
};

/** 069 (US3) — Los tres casos: sesión del mismo correo, de otro, o sin sesión. */
export function AceptarInvitacion({
  token,
  negocio,
  email,
  cuentaExiste,
  sesionEmail,
}: {
  token: string;
  negocio: string;
  email: string;
  cuentaExiste: boolean;
  sesionEmail: string | null;
}) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const mismaSesion = sesionEmail !== null && sesionEmail.toLowerCase() === email.toLowerCase();

  async function aceptar(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setCargando(true);
    try {
      const res = await fetch("/api/invitaciones/aceptar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mismaSesion ? { token } : { token, name, password }),
      });
      const data = (await res.json().catch(() => null)) as
        | { destino?: string; cuentaCreada?: boolean; error?: { code?: string } }
        | null;
      if (!res.ok) {
        setError(MENSAJES[data?.error?.code ?? ""] ?? "No se pudo aceptar la invitación.");
        return;
      }
      // Cuenta nueva: se inicia la sesión con lo que acaba de escribir.
      if (data?.cuentaCreada) {
        const { error: err } = await signIn.email({ email, password });
        if (err) {
          setError("Tu cuenta se creó. Inicia sesión para entrar.");
          return;
        }
      }
      window.location.href = data?.destino ?? "/";
    } finally {
      setCargando(false);
    }
  }

  return (
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle>Te invitaron a {negocio}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-text-2">
          Invitación para <span className="font-medium text-foreground">{email}</span>.
        </p>

        {sesionEmail !== null && !mismaSesion ? (
          <>
            <p className="text-text-2">
              Iniciaste sesión como {sesionEmail}. Cierra sesión y vuelve a abrir este enlace con el correo invitado.
            </p>
            <BotonSalir />
          </>
        ) : mismaSesion ? (
          <Button onClick={() => aceptar()} disabled={cargando} className="w-full">
            {cargando ? "Aceptando…" : "Aceptar y entrar"}
          </Button>
        ) : cuentaExiste ? (
          <>
            <p className="text-text-2">Ya tienes una cuenta con ese correo. Inicia sesión y vuelve a abrir el enlace.</p>
            <Link href="/login" className="text-accent underline underline-offset-4">
              Iniciar sesión
            </Link>
          </>
        ) : (
          <form onSubmit={aceptar} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="inv-nombre">Tu nombre</Label>
              <Input id="inv-nombre" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-pass">Contraseña (mínimo 8 caracteres)</Label>
              <Input
                id="inv-pass"
                type="password"
                required
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={cargando} className="w-full">
              {cargando ? "Creando tu cuenta…" : "Crear cuenta y entrar"}
            </Button>
          </form>
        )}

        {error && (
          <p role="alert" className="text-danger-text">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
