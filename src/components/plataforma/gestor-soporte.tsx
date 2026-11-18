"use client";

import { urlDeNegocio, type RaizPlataforma } from "@/lib/tenancy";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { leerErrorPlataforma } from "@/components/plataforma/errores";

type Acceso = {
  id: string;
  organizationId: string;
  organizacion: string;
  actor: string;
  level: "lectura" | "configuracion";
  reason: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  vigente: boolean;
};

const fecha = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** 069 (US5) — Pedir y cerrar accesos de soporte. */
export function GestorSoporte({
  raiz,
  orgInicial,
  maxHoras,
  organizaciones,
  accesos,
}: {
  raiz: RaizPlataforma | null;
  /** Auditoría 069 (Fix-D): preseleccionado desde «Pedir soporte» en la ficha. */
  orgInicial?: string;
  maxHoras: number;
  organizaciones: { id: string; name: string; slug: string | null }[];
  accesos: Acceso[];
}) {
  const router = useRouter();
  const [org, setOrg] = useState(orgInicial ?? organizaciones[0]?.id ?? "");
  const [level, setLevel] = useState<"lectura" | "configuracion">("lectura");
  const [reason, setReason] = useState("");
  const [hours, setHours] = useState(2);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const slugDe = (id: string) => organizaciones.find((o) => o.id === id)?.slug ?? null;

  async function pedir(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOcupado(true);
    try {
      const res = await fetch(`/api/platform/organizations/${org}/support`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ level, reason, hours }),
      });
      if (!res.ok) {
        setError(leerErrorPlataforma(await res.json().catch(() => null)));
        return;
      }
      setReason("");
      router.refresh();
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Pedir acceso de soporte</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-text-2">
            Sin acceso no ves nada de un negocio. Cada acceso tiene motivo y caducidad (máximo {maxHoras} h), cada
            petición queda registrada y el dueño del negocio lo ve en su Equipo.
          </p>
          <form onSubmit={pedir} className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sop-org">Negocio</Label>
              <select
                id="sop-org"
                value={org}
                onChange={(e) => setOrg(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm"
              >
                {organizaciones.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sop-nivel">Nivel</Label>
              <select
                id="sop-nivel"
                value={level}
                onChange={(e) => setLevel(e.target.value as typeof level)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm"
              >
                <option value="lectura">Lectura (solo ver)</option>
                <option value="configuracion">Configuración (marca, pipeline, agenda, agente, conocimiento)</option>
              </select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="sop-motivo">Motivo (mínimo 10 caracteres; lo verá el dueño)</Label>
              <Input id="sop-motivo" required minLength={10} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sop-horas">Duración (horas)</Label>
              <Input
                id="sop-horas"
                type="number"
                min={0.25}
                max={maxHoras}
                step={0.25}
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
              />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={ocupado || !org}>
                Abrir acceso
              </Button>
            </div>
          </form>
          {error && (
            <p role="alert" className="text-danger-text">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accesos</CardTitle>
        </CardHeader>
        <CardContent>
          {accesos.length === 0 ? (
            <p className="text-sm text-text-3">Ningún acceso todavía.</p>
          ) : (
            <ul className="divide-y text-sm">
              {accesos.map((a) => {
                const slug = slugDe(a.organizationId);
                return (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {a.organizacion} · {a.level === "lectura" ? "lectura" : "configuración"}
                        {a.vigente ? "" : a.revokedAt ? " · cerrado" : " · vencido"}
                      </p>
                      <p className="text-xs text-text-3">
                        {a.actor} · «{a.reason}» · {fecha(a.createdAt)} → {fecha(a.expiresAt)}
                      </p>
                    </div>
                    {a.vigente && (
                      <div className="flex gap-2">
                        {raiz && slug && (
                          <a
                            href={urlDeNegocio(raiz, slug)}
                            className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-fg"
                          >
                            Entrar
                          </a>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            const res = await fetch(`/api/platform/support/${a.id}`, { method: "DELETE" });
                            if (res.ok) router.refresh();
                          }}
                        >
                          Cerrar
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
