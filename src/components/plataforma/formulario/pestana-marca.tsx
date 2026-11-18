"use client";

import { useRef, useState } from "react";
import { Check, ImageUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ACCENT_PRESETS, isValidHex, resolveAccentSet } from "@/lib/branding";
import { CURRENCY_OPTIONS } from "@/lib/money";
import { DENSIDADES, LETRAS, TAMANOS, TEMAS, TEMA_IDS, temaPropio, tokensMiniatura, type Apariencia } from "@/lib/temas";
import type { FormBlueprint } from "@/lib/platform/formulario-blueprint";
import { cn } from "@/lib/utils";
import { Campo, FilaInterruptor, SELECT, Seccion, type Actualizar } from "./controles";

/**
 * Pestaña «Marca y Apariencia»: nombre corto de marca (independiente del
 * nombre legal), color con presets, moneda, apariencia por defecto con vista
 * previa en vivo y —en la ficha— el logo.
 */
export function PestanaMarca({
  f,
  upd,
  organizationId,
}: {
  f: FormBlueprint;
  upd: Actualizar;
  /** Solo al editar: el logo se sube aparte (es un binario, no va en el Blueprint). */
  organizationId?: string;
}) {
  const nombreMarca = f.brand.nameTocado ? f.brand.name : f.organization.name.slice(0, 30);
  const a = f.appearance.valor;
  const setA = (v: Partial<Apariencia>) => upd("appearance", { valor: { ...a, ...v } });
  const propio = a.tema === "propio" ? temaPropio(a.propio) : null;

  return (
    <div className="space-y-4">
      <Seccion titulo="Marca" descripcion="Lo que ve el equipo del negocio y sus clientes en el login, la pestaña y la app.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Nombre de la marca" ayuda="Hasta 30 caracteres. Puede ser distinto del nombre legal.">
            {(id) => (
              <Input
                id={id}
                maxLength={30}
                value={nombreMarca}
                onChange={(e) => upd("brand", { name: e.target.value, nameTocado: true })}
              />
            )}
          </Campo>
          <Campo etiqueta="Moneda">
            {(id) => (
              <select id={id} className={SELECT} value={f.brand.currency} onChange={(e) => upd("brand", { currency: e.target.value })}>
                {CURRENCY_OPTIONS.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            )}
          </Campo>
          <div className="space-y-2 sm:col-span-2">
            <p className="text-sm font-medium">Color de acento</p>
            <div className="flex flex-wrap items-center gap-2">
              {Object.entries(ACCENT_PRESETS).map(([hex, p]) => (
                <button
                  key={hex}
                  type="button"
                  title={p.label}
                  aria-label={p.label}
                  aria-pressed={f.brand.accent.toLowerCase() === hex}
                  onClick={() => upd("brand", { accent: hex })}
                  className="flex h-8 w-8 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition-shadow aria-pressed:ring-2 aria-pressed:ring-ring"
                  style={{ background: hex }}
                >
                  {f.brand.accent.toLowerCase() === hex && <Check className="h-4 w-4 text-white" strokeWidth={2.5} />}
                </button>
              ))}
              <span className="mx-1 h-6 w-px bg-border" aria-hidden />
              <input
                type="color"
                aria-label="Color propio"
                value={isValidHex(f.brand.accent) ? f.brand.accent : "#0d3b9e"}
                onChange={(e) => upd("brand", { accent: e.target.value })}
                className="h-8 w-10 cursor-pointer rounded border bg-background"
              />
              <Input
                aria-label="Color en hexadecimal"
                className="w-28 font-mono"
                value={f.brand.accent}
                onChange={(e) => upd("brand", { accent: e.target.value })}
              />
            </div>
          </div>
        </div>
      </Seccion>

      <Seccion
        titulo="Apariencia por defecto"
        descripcion="La que ve el equipo hasta que cada persona elija la suya. Sin elegir, vale la de la plataforma."
      >
        {f.appearance.guardada ? (
          <p className="rounded-lg bg-subtle px-3 py-2 text-xs text-text-2">
            Este negocio ya tiene su apariencia elegida: aquí se cambia. (Volver a la de la plataforma no se hace desde aquí.)
          </p>
        ) : (
          <FilaInterruptor
            titulo="Definir la apariencia del negocio"
            checked={f.appearance.usar}
            onChange={(v) => upd("appearance", { usar: v })}
          />
        )}
        {(f.appearance.usar || f.appearance.guardada) && (
          <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[...TEMA_IDS, "propio" as const].map((id) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={a.tema === id}
                    onClick={() =>
                      setA(id === "propio" ? { tema: id, propio: a.propio ?? { fondo: "#ffffff", texto: "#141a17", marco: "#e7efea" } } : { tema: id, propio: undefined })
                    }
                    className={cn(
                      "rounded-lg border px-2 py-2 text-left text-xs transition-colors hover:bg-subtle",
                      a.tema === id && "border-brand bg-brand-tint"
                    )}
                  >
                    <span className="block font-medium">{id === "propio" ? "Propio" : TEMAS[id].nombre}</span>
                    <span className="text-text-3">{id === "propio" ? "Tus colores" : TEMAS[id].modo === "dark" ? "Oscuro" : "Claro"}</span>
                  </button>
                ))}
              </div>
              {a.tema === "propio" && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-3">
                    {(["fondo", "texto", "marco"] as const).map((k) => (
                      <label key={k} className="flex items-center gap-2 text-xs capitalize">
                        <input
                          type="color"
                          value={a.propio?.[k] ?? "#ffffff"}
                          onChange={(e) =>
                            setA({ propio: { fondo: "#ffffff", texto: "#141a17", marco: "#e7efea", ...a.propio, [k]: e.target.value } })
                          }
                          className="h-8 w-10 rounded border"
                        />
                        {k}
                      </label>
                    ))}
                  </div>
                  {propio && !propio.ok && <p className="text-xs text-danger-text">{propio.error}</p>}
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-3">
                <Campo etiqueta="Letra">
                  {(id) => (
                    <select id={id} className={SELECT} value={a.letra} onChange={(e) => setA({ letra: e.target.value as Apariencia["letra"] })}>
                      {Object.entries(LETRAS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v.nombre}
                        </option>
                      ))}
                    </select>
                  )}
                </Campo>
                <Campo etiqueta="Tamaño">
                  {(id) => (
                    <select id={id} className={SELECT} value={a.tamano} onChange={(e) => setA({ tamano: e.target.value as Apariencia["tamano"] })}>
                      {Object.entries(TAMANOS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v.nombre}
                        </option>
                      ))}
                    </select>
                  )}
                </Campo>
                <Campo etiqueta="Densidad">
                  {(id) => (
                    <select
                      id={id}
                      className={SELECT}
                      value={a.densidad}
                      onChange={(e) => setA({ densidad: e.target.value as Apariencia["densidad"] })}
                    >
                      {Object.entries(DENSIDADES).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v.nombre}
                        </option>
                      ))}
                    </select>
                  )}
                </Campo>
              </div>
            </div>
            <VistaPrevia nombre={nombreMarca || "Tu negocio"} accent={f.brand.accent} apariencia={a} />
          </div>
        )}
        {!f.appearance.usar && !f.appearance.guardada && <VistaPrevia nombre={nombreMarca || "Tu negocio"} accent={f.brand.accent} />}
      </Seccion>

      {organizationId && <SubirLogo organizationId={organizationId} />}
    </div>
  );
}

/** Vista previa en vivo: tema (o el de la plataforma), acento y nombre. */
function VistaPrevia({ nombre, accent, apariencia }: { nombre: string; accent: string; apariencia?: Apariencia }) {
  const t = tokensMiniatura(apariencia ?? { tema: "vocero" });
  const set = resolveAccentSet(isValidHex(accent) ? accent : "#0d3b9e");
  const inicial = nombre.trim().charAt(0).toUpperCase() || "A";
  return (
    <div aria-label="Vista previa" className="overflow-hidden rounded-xl border" style={{ background: t["--chat-bg"] }}>
      <div className="flex items-center gap-2 border-b px-3 py-2" style={{ background: t["--bg"], borderColor: t["--border"] }}>
        <span
          className="flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold"
          style={{ background: set.accent, color: set.fg }}
        >
          {inicial}
        </span>
        <span className="truncate text-sm font-semibold" style={{ color: t["--text"] }}>
          {nombre}
        </span>
      </div>
      <div className="space-y-2 p-3">
        <div className="h-6 w-3/4 rounded-2xl" style={{ background: t["--bubble-in"] }} />
        <div className="ml-auto h-6 w-2/3 rounded-2xl border" style={{ background: t["--bubble-out"], borderColor: t["--bubble-out-border"] }} />
        <div className="flex justify-end pt-1">
          <span className="rounded-md px-3 py-1 text-xs font-medium" style={{ background: set.accent, color: set.fg }}>
            Botón principal
          </span>
        </div>
      </div>
    </div>
  );
}

/** El logo (icono de pestaña) del negocio, desde su ficha. */
function SubirLogo({ organizationId }: { organizationId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [version, setVersion] = useState(() => Date.now());
  const [estado, setEstado] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const url = `/api/platform/organizations/${organizationId}/favicon`;

  async function llamar(init: RequestInit) {
    setOcupado(true);
    setEstado(null);
    try {
      const res = await fetch(url, init);
      const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) {
        setEstado(data?.error?.message ?? "No se pudo guardar el logo.");
        return;
      }
      setEstado("Guardado.");
      setVersion(Date.now());
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Seccion titulo="Logo" descripcion="PNG, SVG, ICO, JPEG o WebP, hasta 256 KB. Se usa como icono de la pestaña y de la app instalada.">
      <div className="flex flex-wrap items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- vista previa de un archivo del negocio */}
        <img src={`${url}?v=${version}`} alt="Logo actual" className="h-14 w-14 rounded-xl border bg-subtle object-contain p-1" />
        <input
          ref={input}
          type="file"
          accept="image/png,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,image/jpeg,image/webp"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) await llamar({ method: "PUT", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
          }}
        />
        <Button type="button" variant="outline" size="sm" disabled={ocupado} onClick={() => input.current?.click()}>
          <ImageUp className="mr-1.5 h-4 w-4" /> Subir logo
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={ocupado} onClick={() => llamar({ method: "DELETE" })}>
          <Trash2 className="mr-1.5 h-4 w-4" /> Quitar
        </Button>
        {estado && <span className="text-xs text-text-3">{estado}</span>}
      </div>
    </Seccion>
  );
}
