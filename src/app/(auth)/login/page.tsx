"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient, signIn } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * 076 — Dos pasos cuando la cuenta tiene segundo factor (hoy, solo el
 * superadmin del panel): correo y contraseña, y después el código de su app o
 * un código de respaldo. Sin «confiar en este dispositivo»: se pide siempre.
 * Las cuentas de los negocios no tienen segundo factor y entran como siempre.
 */
export default function LoginPage() {
  const router = useRouter();
  const [paso, setPaso] = useState<"credenciales" | "codigo">("credenciales");
  const [respaldo, setRespaldo] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function entrar() {
    // A la raíz, no a la Bandeja: ahí se decide si toca la guía de inicio
    // (#86), la Bandeja de siempre o el panel de Aliantis.
    router.push("/");
    router.refresh();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { data, error: err } = await signIn.email({ email, password });
    setLoading(false);
    if (err) {
      setError(
        err.status === 429
          ? "Demasiados intentos. Espera unos minutos."
          : "Correo o contraseña incorrectos."
      );
      return;
    }
    if ((data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
      setPassword("");
      setPaso("codigo");
      return;
    }
    entrar();
  }

  async function onCodigo(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const code = codigo.trim();
    const { error: err } = respaldo
      ? await authClient.twoFactor.verifyBackupCode({ code })
      : await authClient.twoFactor.verifyTotp({ code });
    setLoading(false);
    if (err) {
      setError(
        err.status === 429
          ? "Demasiados intentos. Espera unos minutos."
          : err.status === 401 && /cookie/i.test(err.message ?? "")
            ? "Pasó demasiado tiempo. Vuelve a escribir tu contraseña."
            : "El código no es válido."
      );
      if (err.status === 401 && /cookie/i.test(err.message ?? "")) setPaso("credenciales");
      return;
    }
    entrar();
  }

  if (paso === "codigo") {
    return (
      <Card className="shadow-md">
        <CardHeader>
          <CardTitle>{respaldo ? "Código de respaldo" : "Código de tu app"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onCodigo} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="codigo">
                {respaldo ? "Uno de tus códigos de respaldo" : "El código de 6 dígitos de tu app de autenticación"}
              </Label>
              <Input
                id="codigo"
                inputMode={respaldo ? "text" : "numeric"}
                autoComplete="one-time-code"
                required
                autoFocus
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Verificando…" : "Entrar"}
            </Button>
            <button
              type="button"
              className="w-full text-sm text-text-3 underline-offset-2 hover:underline"
              onClick={() => {
                setRespaldo(!respaldo);
                setCodigo("");
                setError(null);
              }}
            >
              {respaldo ? "Usar el código de mi app" : "Usar un código de respaldo"}
            </button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle>Iniciar sesión</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Correo</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Contraseña</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Entrando…" : "Entrar"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
