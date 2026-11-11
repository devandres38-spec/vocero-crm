import { cn } from "@/lib/utils";
import type { Tono } from "./formato";

/**
 * 076 — Piezas del panel de Andres: el punto del semáforo, la tarjeta de una
 * sección, un número grande y la barra de gasto frente al tope. Sirven en el
 * servidor y en el cliente.
 */
const PUNTO: Record<Tono, string> = {
  verde: "bg-success",
  ambar: "bg-warning",
  rojo: "bg-danger",
  gris: "bg-text-4",
};

const ETIQUETA_DEL_TONO: Record<Tono, string> = {
  verde: "bien",
  ambar: "revisar",
  rojo: "falla",
  gris: "sin datos",
};

export function Punto({ tono, className }: { tono: Tono; className?: string }) {
  return (
    <span
      className={cn("inline-block size-2.5 shrink-0 rounded-full", PUNTO[tono], className)}
      role="img"
      aria-label={ETIQUETA_DEL_TONO[tono]}
    />
  );
}

export function Seccion({
  titulo,
  accion,
  children,
  className,
}: {
  titulo: string;
  accion?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-lg border border-border-strong bg-card shadow-sm", className)}>
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h2 className="text-[15px] font-bold tracking-tight">{titulo}</h2>
        {accion}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Cifra({ etiqueta, valor, nota }: { etiqueta: string; valor: string; nota?: string }) {
  return (
    <div className="rounded-lg border border-border-strong bg-card p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-3">{etiqueta}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight">{valor}</p>
      {nota && <p className="mt-0.5 text-xs text-text-3">{nota}</p>}
    </div>
  );
}

const BARRA: Record<Tono, string> = {
  verde: "bg-success",
  ambar: "bg-warning",
  rojo: "bg-danger",
  gris: "bg-text-4",
};

/** La barra de un gasto frente a su tope (se corta en el 100 %). */
export function BarraDeGasto({ porcentaje, tono }: { porcentaje: number; tono: Tono }) {
  const ancho = Math.max(0, Math.min(100, porcentaje));
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-accent"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ancho)}
    >
      <div className={cn("h-full rounded-full", BARRA[tono])} style={{ width: `${ancho}%` }} />
    </div>
  );
}

export function Encabezado({ titulo, descripcion, accion }: { titulo: string; descripcion?: string; accion?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight">{titulo}</h1>
        {descripcion && <p className="text-sm text-text-3">{descripcion}</p>}
      </div>
      {accion}
    </div>
  );
}
