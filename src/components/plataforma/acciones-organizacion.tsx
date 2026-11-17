"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EnlaceUnaVez } from "@/components/plataforma/enlace-una-vez";
import { leerErrorPlataforma } from "@/components/plataforma/errores";

/** 069 (US2) — Invitar, revocar, suspender y reactivar un negocio. */
export function AccionesOrganizacion({
  id,
  status,
  invitaciones,
}: {
  id: string;
  status: "activa" | "suspendida";
  invitaciones: { id: string; email: string; role: string | null; expiresAt: string; vencida: boolean }[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"owner" | "admin" | "member">("owner");
  const [enlace, setEnlace] = useState<{ url: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function llamar(path: string, init: RequestInit): Promise<Record<string, unknown> | null> {
    setError(null);
    setOcupado(true);
    try {
      const res = await fetch(`/api/platform/organizations/${id}${path}`, init);
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) {
        setError(leerErrorPlataforma(data));
        return null;
      }
      return data ?? {};
    } finally {
      setOcupado(false);
    }
  }

  async function invitar(e: React.FormEvent) {
    e.preventDefault();
    const data = await llamar("/invitations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    if (data) {
      setEnlace({ url: String(data.url), expiresAt: String(data.expiresAt) });
      setEmail("");
      router.refresh();
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Invitar</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={invitar} className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1 space-y-1.5">
              <Label htmlFor="inv-email">Correo</Label>
              <Input id="inv-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-rol">Rol</Label>
              <select
                id="inv-rol"
                value={role}
                onChange={(e) => setRole(e.target.value as typeof role)}
                className="flex h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm"
              >
                <option value="owner">Dueño</option>
                <option value="admin">Administrador</option>
                <option value="member">Equipo</option>
              </select>
            </div>
            <Button type="submit" disabled={ocupado}>
              Generar enlace
            </Button>
          </form>
          {enlace && <EnlaceUnaVez url={enlace.url} expiresAt={enlace.expiresAt} />}
          {invitaciones.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Pendientes</p>
              <ul className="divide-y text-sm">
                {invitaciones.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      {i.email} <span className="text-text-3">· {i.role ?? "member"}</span>
                      {i.vencida && (
                        <span className="ml-2 rounded bg-warning-tint px-1.5 py-0.5 text-[11px] text-warning-text">
                          Vencida
                        </span>
                      )}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={ocupado}
                      onClick={async () => {
                        if (await llamar(`/invitations/${i.id}`, { method: "DELETE" })) router.refresh();
                      }}
                    >
                      {i.vencida ? "Quitar" : "Revocar"}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Estado</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-text-2">
            {status === "activa"
              ? "Suspender corta el acceso de su equipo y los envíos. Los mensajes que lleguen se siguen guardando."
              : "Reactivar devuelve el acceso y los envíos; no se perdió ningún mensaje."}
          </p>
          <Button
            variant={status === "activa" ? "outline" : "default"}
            disabled={ocupado}
            onClick={async () => {
              if (
                status === "activa" &&
                !window.confirm("¿Suspender este negocio? Su equipo no podrá entrar hasta que lo reactives.")
              ) {
                return;
              }
              if (await llamar(status === "activa" ? "/suspend" : "/reactivate", { method: "POST" })) {
                router.refresh();
              }
            }}
          >
            {status === "activa" ? "Suspender negocio" : "Reactivar negocio"}
          </Button>
        </CardContent>
      </Card>

      {error && (
        <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint p-3 text-sm text-danger-text">
          {error}
        </p>
      )}
    </>
  );
}
