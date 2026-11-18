"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LifeBuoy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { leerErrorPlataforma } from "@/components/plataforma/errores";
import { BotonEntrarNegocio } from "@/components/plataforma/boton-entrar-negocio";
import { Campo, Pastillas, SELECT, Seccion } from "@/components/plataforma/formulario/controles";

type Acceso = {
  id: string;
  organizationId: string;
  organizacion: string;
  actor: string;
  actorId: string;
  level: "lectura" | "configuracion";
  reason: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  vigente: boolean;
};

const fecha = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Pura: la insignia de un acceso de soporte. */
export function estadoAcceso(a: Pick<Acceso, "vigente" | "revokedAt">): { texto: string; variante: "warning" | "secondary" | "destructive" } {
  if (a.vigente) return { texto: "Vigente", variante: "warning" };
  if (a.revokedAt) return { texto: "Revocado", variante: "destructive" };
  return { texto: "Vencido", variante: "secondary" };
}

/**
 * 069 (US5) — Pedir y cerrar accesos de soporte. Auditoría final (F-08):
 * mismo diseño que el resto del panel; «Entrar» solo con accesos propios y
 * por pase de un solo uso.
 */
export function GestorSoporte({
  yo,
  orgInicial,
  maxHoras,
  organizaciones,
  accesos,
}: {
  /** Id de quien mira: solo entra con SUS accesos (con un pase de un solo uso). */
  yo: string;
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
      <Seccion
        titulo="Pedir acceso de soporte"
        descripcion={`Cada acceso tiene motivo, nivel y caducidad (máximo ${maxHoras} h). Cada petición queda registrada y el dueño lo ve en su Equipo.`}
      >
        <form onSubmit={pedir} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
            <Campo etiqueta="Negocio">
              {(id) => (
                <select id={id} value={org} onChange={(e) => setOrg(e.target.value)} className={SELECT}>
                  {organizaciones.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              )}
            </Campo>
            <Campo etiqueta="Duración (horas)">
              {(id) => (
                <Input id={id} type="number" min={0.25} max={maxHoras} step={0.25} value={hours} onChange={(e) => setHours(Number(e.target.value))} />
              )}
            </Campo>
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Nivel</p>
            <Pastillas
              etiqueta="Nivel de acceso"
              valor={level}
              onChange={setLevel}
              opciones={[
                { value: "lectura", label: "Lectura (solo ver)" },
                { value: "configuracion", label: "Configuración" },
              ]}
            />
            <p className="text-xs text-text-3">
              {level === "lectura"
                ? "Ve el negocio sin cambiar nada."
                : "Además puede cambiar marca, pipeline, agenda, agente y conocimiento. Nunca credenciales, canales ni equipo."}
            </p>
          </div>
          <Campo etiqueta="Motivo" ayuda="Mínimo 10 caracteres. Lo verá el dueño.">
            {(id) => <Input id={id} required minLength={10} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Campo>
          <Button type="submit" disabled={ocupado || !org}>
            <LifeBuoy className="mr-1.5 h-4 w-4" /> Abrir acceso
          </Button>
        </form>
        {error && (
          <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint p-3 text-sm text-danger-text">
            {error}
          </p>
        )}
      </Seccion>

      <Seccion titulo={`Accesos (${accesos.length})`}>
        {accesos.length === 0 ? (
          <p className="text-sm text-text-3">Ningún acceso todavía.</p>
        ) : (
          <ul className="divide-y text-sm">
            {accesos.map((a) => {
              const estado = estadoAcceso(a);
              const propio = a.actorId === yo;
              return (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {a.organizacion}
                      <span className="rounded-md bg-subtle px-1.5 py-0.5 text-[11px] font-normal text-text-2">
                        {a.level === "lectura" ? "Lectura" : "Configuración"}
                      </span>
                      <Badge variant={estado.variante}>{estado.texto}</Badge>
                    </p>
                    <p className="text-xs text-text-3">
                      {a.actor} · «{a.reason}» · {fecha(a.createdAt)} → {fecha(a.expiresAt)}
                    </p>
                  </div>
                  {a.vigente && (
                    <div className="flex items-center gap-2">
                      {slugDe(a.organizationId) && propio && (
                        <BotonEntrarNegocio organizationId={a.organizationId} acceso etiqueta="Entrar" />
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
      </Seccion>
    </div>
  );
}
