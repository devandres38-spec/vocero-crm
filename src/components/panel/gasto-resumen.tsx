import Link from "next/link";
import { dolares, numero, tonoDelGasto } from "./formato";
import { BarraDeGasto, Seccion } from "./piezas";

/**
 * 076 — El gasto del LLM en el resumen del panel: hoy y el mes (todos los
 * negocios) y, por negocio, hoy frente a su tope, ordenado por porcentaje.
 * «Hoy» es el de la zona de cada negocio. Si el cerebro no respondió, lo dice.
 */
export type FilaDeGasto = {
  id: string;
  nombre: string;
  hoyUsd: number;
  mesUsd: number;
  topeUsd: number | null;
  pruebasHoyUsd: number;
  fallidasHoy: number;
};

export function GastoResumen({ filas }: { filas: FilaDeGasto[] | null }) {
  if (filas === null) {
    return (
      <Seccion titulo="Gasto del LLM">
        <p className="text-sm text-text-3">
          No se pudo leer el gasto: el cerebro no respondió o no está configurado. Lo demás del panel sigue al día.
        </p>
      </Seccion>
    );
  }
  const hoy = filas.reduce((s, f) => s + f.hoyUsd, 0);
  const mes = filas.reduce((s, f) => s + f.mesUsd, 0);
  const pruebas = filas.reduce((s, f) => s + f.pruebasHoyUsd, 0);
  const orden = [...filas].sort((a, b) => porcentaje(b) - porcentaje(a));
  return (
    <Seccion titulo="Gasto del LLM">
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-text-3">Hoy</p>
          <p className="text-xl font-bold tabular-nums">{dolares(hoy)}</p>
          <p className="text-xs text-text-3">{dolares(pruebas)} del Laboratorio · cada negocio en su zona</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-text-3">Este mes</p>
          <p className="text-xl font-bold tabular-nums">{dolares(mes)}</p>
        </div>
      </div>
      {orden.length === 0 ? (
        <p className="text-sm text-text-3">Todavía ningún negocio usa el LLM.</p>
      ) : (
        <ul className="space-y-3">
          {orden.map((f) => (
            <li key={f.id}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                <Link href={`/admin/negocios/${f.id}`} className="truncate font-semibold hover:underline">
                  {f.nombre}
                </Link>
                <span className="shrink-0 tabular-nums text-text-3">
                  {dolares(f.hoyUsd)} / {f.topeUsd === null ? "sin tope" : dolares(f.topeUsd)}
                  {f.fallidasHoy > 0 && ` · ${numero(f.fallidasHoy)} ${f.fallidasHoy === 1 ? "fallida" : "fallidas"}`}
                </span>
              </div>
              <BarraDeGasto porcentaje={porcentaje(f)} tono={tonoDelGasto(f.hoyUsd, f.topeUsd)} />
            </li>
          ))}
        </ul>
      )}
    </Seccion>
  );
}

function porcentaje(f: FilaDeGasto): number {
  return f.topeUsd && f.topeUsd > 0 ? (f.hoyUsd / f.topeUsd) * 100 : 0;
}
