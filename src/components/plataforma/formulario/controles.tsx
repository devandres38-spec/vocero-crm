"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { FormBlueprint } from "@/lib/platform/formulario-blueprint";

/** Auditoría 069 (Fix-C/D) — Piezas comunes de las pestañas del FormularioBlueprint. */

export type Actualizar = <K extends keyof FormBlueprint>(k: K, v: Partial<FormBlueprint[K]>) => void;

export const SELECT =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:border-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-soft disabled:opacity-50";

/** Un bloque con título dentro de una pestaña. */
export function Seccion({
  titulo,
  descripcion,
  children,
  accion,
}: {
  titulo: string;
  descripcion?: React.ReactNode;
  children: React.ReactNode;
  accion?: React.ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-xl border bg-background p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{titulo}</h3>
          {descripcion && <p className="mt-0.5 text-xs text-text-3">{descripcion}</p>}
        </div>
        {accion}
      </div>
      {children}
    </section>
  );
}

/** Etiqueta + control + ayuda. `children` recibe el id para el control. */
export function Campo({
  etiqueta,
  ayuda,
  className,
  children,
}: {
  etiqueta: string;
  ayuda?: React.ReactNode;
  className?: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>{etiqueta}</Label>
      {children(id)}
      {ayuda && <p className="text-xs text-text-3">{ayuda}</p>}
    </div>
  );
}

/** Interruptor con título y descripción, en una fila. */
export function FilaInterruptor({
  titulo,
  descripcion,
  checked,
  onChange,
  disabled,
  nota,
}: {
  titulo: string;
  descripcion?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  nota?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 py-3", disabled && "opacity-60")}>
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {titulo}
          {nota && <span className="ml-2 rounded bg-subtle px-1.5 py-0.5 text-[11px] font-normal text-text-3">{nota}</span>}
        </p>
        {descripcion && <p className="text-xs text-text-3">{descripcion}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} label={titulo} disabled={disabled} />
    </div>
  );
}

/**
 * Un `<select>` con opciones sugeridas y «Otro…» para escribir un valor
 * propio (p. ej. una zona horaria que no está en la lista).
 */
export function SelectGuiado({
  id,
  valor,
  opciones,
  onChange,
  placeholderOtro,
}: {
  id: string;
  valor: string;
  opciones: { value: string; label: string }[];
  onChange: (v: string) => void;
  placeholderOtro?: string;
}) {
  const conocido = opciones.some((o) => o.value === valor);
  const [otro, setOtro] = useState(!conocido && valor !== "");
  return (
    <div className="space-y-2">
      <select
        id={id}
        className={SELECT}
        value={otro || !conocido ? "__otro" : valor}
        onChange={(e) => {
          if (e.target.value === "__otro") {
            setOtro(true);
            return;
          }
          setOtro(false);
          onChange(e.target.value);
        }}
      >
        {opciones.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        <option value="__otro">Otro…</option>
      </select>
      {(otro || !conocido) && (
        <Input aria-label="Valor propio" value={valor} placeholder={placeholderOtro} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

/** Botones de opción con aspecto de pastilla (`merge` / `exact`, filtros…). */
export function Pastillas<T extends string>({
  valor,
  opciones,
  onChange,
  etiqueta,
}: {
  valor: T;
  opciones: { value: T; label: string }[];
  onChange: (v: T) => void;
  etiqueta: string;
}) {
  return (
    <div role="radiogroup" aria-label={etiqueta} className="inline-flex flex-wrap gap-1 rounded-lg bg-subtle p-1">
      {opciones.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={valor === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-3 py-1 text-xs font-medium transition-colors",
            valor === o.value ? "bg-background text-foreground shadow-sm" : "text-text-3 hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Botón pequeño de icono (subir, bajar, quitar). */
export function BotonIcono({
  etiqueta,
  onClick,
  disabled,
  children,
  peligro,
}: {
  etiqueta: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  peligro?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={etiqueta}
      title={etiqueta}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-3 transition-colors hover:bg-subtle hover:text-foreground disabled:pointer-events-none disabled:opacity-30",
        peligro && "hover:bg-danger-tint hover:text-danger-text"
      )}
    >
      {children}
    </button>
  );
}

/** Pura: mover un elemento de una lista (para reordenar). */
export function mover<T>(xs: T[], i: number, delta: number): T[] {
  const j = i + delta;
  if (j < 0 || j >= xs.length) return xs;
  const copia = [...xs];
  [copia[i], copia[j]] = [copia[j]!, copia[i]!];
  return copia;
}
