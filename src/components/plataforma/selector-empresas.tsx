"use client";

import { useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BotonSalir } from "@/components/plataforma/boton-salir";

type Empresa = { organizationId: string; name: string; slug: string | null; role: string; suspendida: boolean };

const ROL: Record<string, string> = { owner: "Dueño", admin: "Administrador", member: "Equipo" };

/** 069 (US3) — Elegir empresa sin cerrar sesión. */
export function SelectorEmpresas({
  base,
  superAdmin,
  empresas,
}: {
  base: string | null;
  superAdmin: boolean;
  empresas: Empresa[];
}) {
  const [error, setError] = useState<string | null>(null);

  async function activar(organizationId: string) {
    setError(null);
    const { error: err } = await authClient.organization.setActive({ organizationId });
    if (err) {
      setError("No se pudo cambiar de empresa.");
      return;
    }
    window.location.href = "/";
  }

  return (
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle>Tus empresas</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {empresas.length === 0 ? (
          <p className="text-text-2">
            Aún no perteneces a ningún negocio. Abre el enlace de invitación que te enviaron.
          </p>
        ) : (
          <ul className="divide-y">
            {empresas.map((e) => (
              <li key={e.organizationId} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate font-medium">{e.name}</p>
                  <p className="text-xs text-text-3">
                    {ROL[e.role] ?? e.role}
                    {e.suspendida ? " · suspendida" : ""}
                  </p>
                </div>
                {e.suspendida ? null : base && e.slug ? (
                  <a
                    href={`https://${e.slug}.${base}/`}
                    className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-fg"
                  >
                    Entrar
                  </a>
                ) : (
                  <Button size="sm" onClick={() => activar(e.organizationId)}>
                    Entrar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {superAdmin && (
          <Link href="/platform" className="block text-accent underline underline-offset-4">
            Ir al panel de la plataforma
          </Link>
        )}
        {error && (
          <p role="alert" className="text-danger-text">
            {error}
          </p>
        )}
        <BotonSalir />
      </CardContent>
    </Card>
  );
}
