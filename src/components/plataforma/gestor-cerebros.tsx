"use client";

import { useRegion } from "@/lib/region-context";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, BrainCircuit, Check, Copy, Pause, Pencil, Play, RefreshCw, Trash2 } from "lucide-react";
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

const fecha = (iso: string | null, locale: string) =>
  iso ? new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) : "nunca";

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

/** Pura (auditoría 070, A-3): host + ruta, para ver de un vistazo a dónde se despacha. */
export function destinoVisible(c: Pick<CerebroVista, "dispatchUrl" | "host">): string {
  try {
    const u = new URL(c.dispatchUrl);
    return `${u.host}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return c.host;
  }
}

/** Pura (B-5): la versión con una sola «v». */
export function etiquetaVersion(v: string): string {
  return /^v/i.test(v) ? v : `v${v}`;
}

/** Pura (M-9): ¿el secreto pegado sirve? (mismas reglas que el servidor) */
export function secretoPegadoValido(s: string): boolean {
  const t = s.trim();
  return t.length >= 32 && t.length <= 256 && !/\s/.test(t);
}

const MENSAJE_RED = "No se pudo hablar con el servidor. Revisa tu conexión y vuelve a intentar.";

/** Edición en línea de nombre y URLs (A-3: antes no había forma de corregirlas). */
function EditarCerebro({
  c,
  ocupado,
  onGuardar,
  onCancelar,
}: {
  c: CerebroVista;
  ocupado: boolean;
  onGuardar: (cambios: { name: string; dispatchUrl: string; healthUrl: string | null }) => void;
  onCancelar: () => void;
}) {
  const [name, setName] = useState(c.name);
  const [dispatchUrl, setDispatchUrl] = useState(c.dispatchUrl);
  const [healthUrl, setHealthUrl] = useState(c.healthUrl ?? "");
  return (
    <form
      className="space-y-3 rounded-lg border bg-subtle p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onGuardar({ name: name.trim(), dispatchUrl: dispatchUrl.trim(), healthUrl: healthUrl.trim() || null });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Nombre">
          {(id) => <Input id={id} required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />}
        </Campo>
        <Campo etiqueta="URL de despacho" ayuda="Con la ruta: …/vocero/dispatch">
          {(id) => <Input id={id} required type="url" value={dispatchUrl} onChange={(e) => setDispatchUrl(e.target.value)} />}
        </Campo>
        <Campo etiqueta="URL de salud (opcional)" ayuda="Vacío = /health en el mismo origen.">
          {(id) => <Input id={id} type="url" value={healthUrl} onChange={(e) => setHealthUrl(e.target.value)} />}
        </Campo>
      </div>
      <div className="flex gap-2">
        <Button size="sm" type="submit" disabled={ocupado}>
          Guardar
        </Button>
        <Button size="sm" type="button" variant="outline" onClick={onCancelar}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

export function GestorCerebros({ inicial }: { inicial: CerebroVista[] }) {
  // 073-C (D7): fechas en el idioma de la región del negocio, no del navegador.
  const { locale } = useRegion();
  const router = useRouter();
  const [name, setName] = useState("");
  const [dispatchUrl, setDispatchUrl] = useState("");
  const [healthUrl, setHealthUrl] = useState("");
  const [pegar, setPegar] = useState(false);
  const [secretoPegado, setSecretoPegado] = useState("");
  const [nuevo, setNuevo] = useState<{ id: string; secreto: string; origen: "crear" | "rotar" } | null>(null);
  // M-9: el error del alta va junto al formulario; el de una fila, junto a esa fila.
  const [error, setError] = useState<{ donde: string; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [rotando, setRotando] = useState<string | null>(null);
  const [secretoRotar, setSecretoRotar] = useState("");

  async function llamar(clave: string, donde: string, url: string, init: RequestInit): Promise<Record<string, unknown> | null> {
    setError(null);
    setOcupado(clave);
    try {
      const res = await fetch(url, init);
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) {
        setError({ donde, texto: leerErrorPlataforma(data) });
        return null;
      }
      return data ?? {};
    } catch {
      // M-9: sin red, `fetch` lanza; antes se perdía en silencio.
      setError({ donde, texto: MENSAJE_RED });
      return null;
    } finally {
      setOcupado(null);
    }
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    // M-9: «pegar» encendido con el campo vacío generaba uno nuevo en silencio.
    if (pegar && !secretoPegadoValido(secretoPegado)) {
      setError({ donde: "alta", texto: "Pega un secreto de al menos 32 caracteres, sin espacios, o apaga «Pegar un secreto existente»." });
      return;
    }
    const data = await llamar("crear", "alta", "/api/platform/brains", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        dispatchUrl,
        healthUrl: healthUrl.trim() || null,
        ...(pegar ? { secret: secretoPegado.trim() } : {}),
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
    if (await llamar(`probar:${id}`, id, `/api/platform/brains/${id}/probar`, { method: "POST" })) router.refresh();
  }

  async function guardarEdicion(c: CerebroVista, cambios: { name: string; dispatchUrl: string; healthUrl: string | null }) {
    const ok = await llamar(`editar:${c.id}`, c.id, `/api/platform/brains/${c.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cambios),
    });
    if (ok) {
      setEditando(null);
      router.refresh();
    }
  }

  async function rotar(c: CerebroVista) {
    const pegado = secretoRotar.trim();
    // M-9: también se puede rotar al secreto que ya tiene Nea.
    if (pegado && !secretoPegadoValido(pegado)) {
      setError({ donde: c.id, texto: "El secreto pegado debe tener al menos 32 caracteres, sin espacios." });
      return;
    }
    const aviso =
      c.organizations > 0
        ? `¿Rotar el secreto de «${c.name}»? El actual deja de valer YA: hasta que el nuevo esté en Nea, sus ${c.organizations} negocio(s) quedan en bandeja manual y los despachos en vuelo pasan a una persona.`
        : `¿Rotar el secreto de «${c.name}»? El actual deja de valer de inmediato.`;
    if (!window.confirm(aviso)) return;
    const data = await llamar(`rotar:${c.id}`, c.id, `/api/platform/brains/${c.id}/rotar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pegado ? { secret: pegado } : {}),
    });
    if (data && typeof data.secret === "string") {
      setNuevo({ id: c.id, secreto: data.secret, origen: "rotar" });
      setRotando(null);
      setSecretoRotar("");
      router.refresh();
    }
  }

  async function cambiarEstado(c: CerebroVista) {
    const status = c.status === "activo" ? "pausado" : "activo";
    if (status === "pausado" && !window.confirm(`¿Pausar «${c.name}»? Deja de despachar a sus ${c.organizations} negocio(s).`)) return;
    const ok = await llamar(`estado:${c.id}`, c.id, `/api/platform/brains/${c.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (ok) router.refresh();
  }

  async function borrar(c: CerebroVista) {
    if (!window.confirm(`¿Borrar «${c.name}»? No se puede deshacer.`)) return;
    if (await llamar(`borrar:${c.id}`, c.id, `/api/platform/brains/${c.id}`, { method: "DELETE" })) router.refresh();
  }

  const errorEn = (donde: string) =>
    error?.donde === donde ? (
      <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint p-3 text-sm text-danger-text">
        {error.texto}
      </p>
    ) : null;

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
            <Campo etiqueta="URL de despacho" ayuda="Con la ruta donde Nea recibe: …/vocero/dispatch">
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
                  required
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
        {errorEn("alta")}
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
                        <span className="font-mono">{destinoVisible(c)}</span> · {c.organizations} negocio(s) · probado {fecha(c.lastHealthAt, locale)}
                        {typeof detalle.version === "string" ? ` · ${etiquetaVersion(detalle.version)}` : ""}
                        {typeof detalle.error === "string" && detalle.error ? ` · ${detalle.error}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" disabled={ocupado !== null} onClick={() => probar(c.id)}>
                        <Activity className="mr-1.5 h-4 w-4" /> Probar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={ocupado !== null}
                        onClick={() => setEditando(editando === c.id ? null : c.id)}
                      >
                        <Pencil className="mr-1.5 h-4 w-4" /> Editar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={ocupado !== null}
                        onClick={() => {
                          setRotando(rotando === c.id ? null : c.id);
                          setSecretoRotar("");
                        }}
                      >
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
                  {editando === c.id && (
                    <EditarCerebro
                      c={c}
                      ocupado={ocupado !== null}
                      onGuardar={(cambios) => guardarEdicion(c, cambios)}
                      onCancelar={() => setEditando(null)}
                    />
                  )}
                  {rotando === c.id && (
                    <div className="space-y-2 rounded-lg border bg-subtle p-3">
                      <Campo etiqueta="Pegar el secreto que ya tiene Nea (opcional)" ayuda="Vacío = se genera uno nuevo y se muestra una vez.">
                        {(id) => (
                          <Input
                            id={id}
                            type="password"
                            autoComplete="off"
                            maxLength={256}
                            value={secretoRotar}
                            onChange={(e) => setSecretoRotar(e.target.value)}
                          />
                        )}
                      </Campo>
                      <div className="flex gap-2">
                        <Button size="sm" type="button" disabled={ocupado !== null} onClick={() => rotar(c)}>
                          Rotar
                        </Button>
                        <Button size="sm" type="button" variant="outline" onClick={() => setRotando(null)}>
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  )}
                  {nuevo?.origen === "rotar" && nuevo.id === c.id && <SecretoUnaVez secreto={nuevo.secreto} />}
                  {errorEn(c.id)}
                </li>
              );
            })}
          </ul>
        )}
      </Seccion>
    </div>
  );
}
