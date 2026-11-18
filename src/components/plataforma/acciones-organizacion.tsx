"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MailPlus, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EnlaceUnaVez } from "@/components/plataforma/enlace-una-vez";
import { leerErrorPlataforma } from "@/components/plataforma/errores";
import { SELECT, Seccion } from "@/components/plataforma/formulario/controles";

/** 069 (US2) — Invitar, revocar, suspender y reactivar un negocio. */

type Invitacion = { id: string; email: string; role: string | null; expiresAt: string; vencida: boolean };

const ROL: Record<string, string> = { owner: "Dueño", admin: "Administrador", member: "Equipo" };

function useLlamada(id: string) {
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
  return { llamar, error, ocupado };
}

function Error({ texto }: { texto: string | null }) {
  return texto ? (
    <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint p-3 text-sm text-danger-text">
      {texto}
    </p>
  ) : null;
}

/** Pestaña «Invitaciones»: generar un enlace de un uso y gestionar las pendientes. */
export function InvitacionesOrganizacion({ id, invitaciones }: { id: string; invitaciones: Invitacion[] }) {
  const router = useRouter();
  const { llamar, error, ocupado } = useLlamada(id);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"owner" | "admin" | "member">("owner");
  const [enlace, setEnlace] = useState<{ url: string; expiresAt: string } | null>(null);

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
    <div className="space-y-4">
      <Seccion
        titulo="Invitar"
        descripcion="Enlace de un solo uso, válido 7 días. No se envía ningún correo: lo copias tú. Un enlace nuevo anula el pendiente del mismo correo."
      >
        <form onSubmit={invitar} className="flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1 space-y-1.5">
            <Label htmlFor="inv-email">Correo</Label>
            <Input id="inv-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="w-44 space-y-1.5">
            <Label htmlFor="inv-rol">Rol</Label>
            <select id="inv-rol" value={role} onChange={(e) => setRole(e.target.value as typeof role)} className={SELECT}>
              <option value="owner">Dueño</option>
              <option value="admin">Administrador</option>
              <option value="member">Equipo</option>
            </select>
          </div>
          <Button type="submit" disabled={ocupado}>
            <MailPlus className="mr-1.5 h-4 w-4" /> Generar enlace
          </Button>
        </form>
        {enlace && <EnlaceUnaVez url={enlace.url} expiresAt={enlace.expiresAt} />}
      </Seccion>

      <Seccion titulo={`Pendientes (${invitaciones.length})`}>
        {invitaciones.length === 0 ? (
          <p className="text-sm text-text-3">No hay invitaciones pendientes.</p>
        ) : (
          <ul className="divide-y text-sm">
            {invitaciones.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="font-medium">{i.email}</span>{" "}
                  <span className="text-text-3">· {ROL[i.role ?? "member"] ?? i.role}</span>
                  {i.vencida ? (
                    <span className="ml-2 rounded bg-warning-tint px-1.5 py-0.5 text-[11px] text-warning-text">Vencida</span>
                  ) : (
                    <span className="ml-2 text-xs text-text-3">
                      vence {new Date(i.expiresAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
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
        )}
      </Seccion>
      <Error texto={error} />
    </div>
  );
}

/** Suspender / reactivar, como acción rápida del encabezado de la ficha. */
export function BotonEstado({ id, status }: { id: string; status: "activa" | "suspendida" }) {
  const router = useRouter();
  const { llamar, error, ocupado } = useLlamada(id);
  return (
    <>
      <Button
        size="sm"
        variant={status === "activa" ? "outline" : "default"}
        disabled={ocupado}
        title={
          status === "activa"
            ? "Corta el acceso de su equipo y los envíos. Los mensajes que lleguen se siguen guardando."
            : "Devuelve el acceso y los envíos; no se perdió ningún mensaje."
        }
        onClick={async () => {
          if (status === "activa" && !window.confirm("¿Suspender este negocio? Su equipo no podrá entrar hasta que lo reactives.")) {
            return;
          }
          if (await llamar(status === "activa" ? "/suspend" : "/reactivate", { method: "POST" })) router.refresh();
        }}
      >
        {status === "activa" ? <Pause className="mr-1.5 h-4 w-4" /> : <Play className="mr-1.5 h-4 w-4" />}
        {status === "activa" ? "Suspender" : "Reactivar"}
      </Button>
      {error && <span className="basis-full text-xs text-danger-text">{error}</span>}
    </>
  );
}
