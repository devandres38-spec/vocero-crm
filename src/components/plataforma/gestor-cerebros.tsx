"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, BrainCircuit, Check, Copy, Pause, Play, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { leerErrorPlataforma } from "@/components/plataforma/errores";
import { Campo, FilaInterruptor, Seccion } from "@/components/plataforma/formulario/controles";
import { COPIA_MANUAL, copiarAlPortapapeles } from "@/lib/clipboard";

/**
 * 070 (US1) — Despliegues de cerebro: registrar una Nea `multiorg`, ver su
 * salud, rotar su secreto y pausarla. El secreto se ve UNA vez (al crear o
 * rotar) para pegarlo en `CRM_BRAIN_SECRET` de Nea; después solo sus últimos 4.
 */

export type CerebroVista = {
  id: string;
  name: string;
  dispatchUrl: string;
  healthUrl: string | null;
  host: string;
  secretLast4: string;
  status: "activo" | "pausado";
  lastHealthAt: string | null;
  lastHealthOk: boolean | null;
  lastHealthDetail: Record<string, unknown> | null;
  organizations: number;
};

const fecha = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "nunca";

export type EstadoSalud = "sano" | "aviso" | "caido" | "sin_probar";

/** Pura: cómo se pinta la salud de un despliegue. */
export function estadoSalud(c: Pick<CerebroVista, "lastHealthOk" | "lastHealthDetail">): EstadoSalud {
  if (c.lastHealthOk === null) return "sin_probar";
  if (!c.lastHealthOk) return "caido";
  return c.lastHealthDetail?.mode === "multiorg" ? "sano" : "aviso";
}

export const INSIGNIA_SALUD: Record<EstadoSalud, { texto: string; variante: "success" | "secondary" | "destructive" | "warning" }> = {
  sano: { texto: "Sano · multiorg", variante: "success" },
  aviso: { texto: "Responde, pero no es multiorg", variante: "warning" },
  caido: { texto: "No responde", variante: "destructive" },
  sin_probar: { texto: "Sin probar", variante: "secondary" },
};

/** El secreto recién creado o rotado, con su botón de copiar. */
function SecretoUnaVez({ secreto }: { secreto: string }) {
  const [copiado, setCopiado] = useState<boolean | null>(null);
  return (
    <div className="space-y-2 rounded-lg border border-warning-soft bg-warning-tint p-3 text-sm">
      <p className="font-medium text-warning-text">
        Copia el secreto ahora y pégalo en <code className="font-mono">CRM_BRAIN_SECRET</code> de Nea: no se puede volver a mostrar.
      </p>
      <code className="block select-all break-all rounded bg-background p-2 font-mono text-xs">{secreto}</code>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" type="button" onClick={async () => setCopiado(await copiarAlPortapapeles(secreto))}>
          {copiado ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
          {copiado ? "Copiado" : "Copiar"}
        </Button>
        {copiado === false && <span className="text-xs text-danger-text">{COPIA_MANUAL}</span>}
      </div>
    </div>
  );
}

export function GestorCerebros({ inicial }: { inicial: CerebroVista[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [dispatchUrl, setDispatchUrl] = useState("");
  const [healthUrl, setHealthUrl] = useState("");
  const [pegar, setPegar] = useState(false);
  const [secretoPegado, setSecretoPegado] = useState("");
  const [nuevo, setNuevo] = useState<{ id: string; secreto: string; origen: "crear" | "rotar" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  async function llamar(clave: string, url: string, init: RequestInit): Promise<Record<string, unknown> | null> {
    setError(null);
    setOcupado(clave);
    try {
      const res = await fetch(url, init);
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) {
        setError(leerErrorPlataforma(data));
        return null;
      }
      return data ?? {};
    } finally {
      setOcupado(null);
    }
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    const data = await llamar("crear", "/api/platform/brains", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        dispatchUrl,
        healthUrl: healthUrl.trim() || null,
        ...(pegar && secretoPegado.trim() ? { secret: secretoPegado.trim() } : {}),
      }),
    });
    const d = data?.deployment as { id?: string } | undefined;
    if (data && typeof data.secret === "string" && d?.id) {
      setNuevo({ id: d.id, secreto: data.secret, origen: "crear" });
      setName("");
      setDispatchUrl("");
      setHealthUrl("");
      setSecretoPegado("");
      setPegar(false);
      router.refresh();
    }
  }

  async function probar(id: string) {
    if (await llamar(`probar:${id}`, `/api/platform/brains/${id}/probar`, { method: "POST" })) router.refresh();
  }

  async function rotar(c: CerebroVista) {
    const aviso =
      c.organizations > 0
        ? `¿Rotar el secreto de «${c.name}»? El actual deja de valer YA: hasta que pegues el nuevo en Nea, sus ${c.organizations} negocio(s) quedan en bandeja manual y los despachos en vuelo pasan a una persona.`
        : `¿Rotar el secreto de «${c.name}»? El actual deja de valer de inmediato.`;
    if (!window.confirm(aviso)) return;
    const data = await llamar(`rotar:${c.id}`, `/api/platform/brains/${c.id}/rotar`, { method: "POST" });
    if (data && typeof data.secret === "string") {
      setNuevo({ id: c.id, secreto: data.secret, origen: "rotar" });
      router.refresh();
    }
  }

  async function cambiarEstado(c: CerebroVista) {
    const status = c.status === "activo" ? "pausado" : "activo";
    if (status === "pausado" && !window.confirm(`¿Pausar «${c.name}»? Deja de despachar a sus ${c.organizations} negocio(s).`)) return;
    const ok = await llamar(`estado:${c.id}`, `/api/platform/brains/${c.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (ok) router.refresh();
  }

  async function borrar(c: CerebroVista) {
    if (!window.confirm(`¿Borrar «${c.name}»? No se puede deshacer.`)) return;
    if (await llamar(`borrar:${c.id}`, `/api/platform/brains/${c.id}`, { method: "DELETE" })) router.refresh();
  }

  return (
    <div className="space-y-4">
      <Seccion
        titulo="Registrar un cerebro"
        descripcion="Una Nea con VOCERO_MODE=cloud y CRM_ORGANIZATION vacía atiende a todos los negocios que le asignes. Su secreto firma los despachos y deriva la credencial de cada negocio."
      >
        <form onSubmit={crear} className="space-y-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Nombre">
              {(id) => <Input id={id} required maxLength={60} placeholder="Nea Producción" value={name} onChange={(e) => setName(e.target.value)} />}
            </Campo>
            <Campo etiqueta="URL de despacho" ayuda="Donde Nea recibe: …/vocero/dispatch">
              {(id) => (
                <Input
                  id={id}
                  required
                  type="url"
                  placeholder="http://nea:8000/vocero/dispatch"
                  value={dispatchUrl}
                  onChange={(e) => setDispatchUrl(e.target.value)}
                />
              )}
            </Campo>
            <Campo etiqueta="URL de salud (opcional)" ayuda="Vacío = /health en el mismo origen.">
              {(id) => <Input id={id} type="url" value={healthUrl} onChange={(e) => setHealthUrl(e.target.value)} />}
            </Campo>
          </div>
          <FilaInterruptor
            titulo="Pegar un secreto existente"
            descripcion="Si esa Nea ya tiene CRM_BRAIN_SECRET. Si no, se genera uno."
            checked={pegar}
            onChange={setPegar}
          />
          {pegar && (
            <Campo etiqueta="Secreto (mínimo 32 caracteres)">
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete="off"
                  minLength={32}
                  maxLength={256}
                  value={secretoPegado}
                  onChange={(e) => setSecretoPegado(e.target.value)}
                />
              )}
            </Campo>
          )}
          <Button type="submit" disabled={ocupado !== null}>
            <BrainCircuit className="mr-1.5 h-4 w-4" /> Registrar
          </Button>
        </form>
        {nuevo?.origen === "crear" && <SecretoUnaVez secreto={nuevo.secreto} />}
        {error && (
          <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint p-3 text-sm text-danger-text">
            {error}
          </p>
        )}
      </Seccion>

      <Seccion titulo={`Cerebros (${inicial.length})`}>
        {inicial.length === 0 ? (
          <p className="text-sm text-text-3">Aún no hay cerebros. Sin uno asignado, un negocio atiende su bandeja a mano.</p>
        ) : (
          <ul className="divide-y text-sm">
            {inicial.map((c) => {
              const salud = INSIGNIA_SALUD[estadoSalud(c)];
              const detalle = c.lastHealthDetail ?? {};
              return (
                <li key={c.id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        {c.name}
                        <span className="font-mono text-xs text-text-3">…{c.secretLast4}</span>
                        <Badge variant={salud.variante}>{salud.texto}</Badge>
                        {c.status === "pausado" && <Badge variant="secondary">Pausado</Badge>}
                      </p>
                      <p className="truncate text-xs text-text-3">
                        {c.host} · {c.organizations} negocio(s) · probado {fecha(c.lastHealthAt)}
                        {typeof detalle.version === "string" ? ` · v${detalle.version}` : ""}
                        {typeof detalle.error === "string" && detalle.error ? ` · ${detalle.error}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" disabled={ocupado !== null} onClick={() => probar(c.id)}>
                        <Activity className="mr-1.5 h-4 w-4" /> Probar
                      </Button>
                      <Button size="sm" variant="outline" disabled={ocupado !== null} onClick={() => rotar(c)}>
                        <RefreshCw className="mr-1.5 h-4 w-4" /> Rotar secreto
                      </Button>
                      <Button size="sm" variant="outline" disabled={ocupado !== null} onClick={() => cambiarEstado(c)}>
                        {c.status === "activo" ? <Pause className="mr-1.5 h-4 w-4" /> : <Play className="mr-1.5 h-4 w-4" />}
                        {c.status === "activo" ? "Pausar" : "Reactivar"}
                      </Button>
                      {c.organizations === 0 && (
                        <Button size="sm" variant="outline" aria-label={`Borrar ${c.name}`} disabled={ocupado !== null} onClick={() => borrar(c)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {nuevo?.origen === "rotar" && nuevo.id === c.id && <SecretoUnaVez secreto={nuevo.secreto} />}
                </li>
              );
            })}
          </ul>
        )}
      </Seccion>
    </div>
  );
}
