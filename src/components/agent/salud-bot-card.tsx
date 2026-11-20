"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber } from "@/lib/region";
import { useRegion } from "@/lib/region-context";

/**
 * 074 (D9, FR-14) — Salud del bot: uso del modelo de los últimos 7 días
 * (llamadas, errores, tokens de entrada / caché / salida, latencia) e
 * incidentes recientes con filtro por tipo. Sin textos ni datos del cliente.
 */

type Uso = {
  llamadas: number;
  errores: number;
  tokensEntrada: number;
  tokensCache: number;
  tokensSalida: number;
  latenciaP50Ms: number | null;
  latenciaPromedioMs: number | null;
  porFuente: Record<string, number>;
};

type Incidente = {
  id: string;
  kind: string;
  detail: string | null;
  count: number;
  conversationId: string | null;
  lastAt: string;
};

type Respuesta = { days: number; usage: Uso; incidents: Incidente[]; kinds: string[] };

const NOMBRE_INCIDENTE: Record<string, string> = {
  despacho_caducado: "Agente sin respuesta",
  sin_saldo: "Sin saldo en la llave de IA",
  sin_credencial: "Sin llave de IA",
  envio_permanente: "Mensaje que no se pudo enviar",
  abuso: "Tope anti-flood",
};

const NOMBRE_FUENTE: Record<string, string> = {
  turn: "Conversaciones",
  ensayo: "Pruebas",
  lab: "Laboratorio",
  transcribe: "Notas de voz",
};

export function SaludBotCard() {
  const { locale } = useRegion();
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [tipo, setTipo] = useState("");

  const cargar = useCallback(async () => {
    const q = tipo ? `?kind=${encodeURIComponent(tipo)}` : "";
    const d = (await fetch(`/api/agent/health${q}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)) as Respuesta | null;
    setDatos(d);
  }, [tipo]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!datos) return null;
  const u = datos.usage;
  const n = (v: number) => formatNumber(v, locale);
  const fecha = (iso: string) =>
    new Date(iso).toLocaleString(locale, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Salud del agente</CardTitle>
        <CardDescription>Últimos {datos.days} días. Los tokens los cobra tu proveedor de IA.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Dato titulo="Llamadas al modelo" valor={n(u.llamadas)} />
          <Dato titulo="Con error" valor={n(u.errores)} alerta={u.errores > 0} />
          <Dato titulo="Tokens de entrada" valor={n(u.tokensEntrada)} detalle={`${n(u.tokensCache)} en caché`} />
          <Dato titulo="Tokens de salida" valor={n(u.tokensSalida)} />
          <Dato
            titulo="Latencia (mediana)"
            valor={u.latenciaP50Ms === null ? "—" : `${n(Math.round(u.latenciaP50Ms / 100) / 10)} s`}
            detalle={u.latenciaPromedioMs === null ? undefined : `promedio ${n(Math.round(u.latenciaPromedioMs / 100) / 10)} s`}
          />
          {Object.entries(u.porFuente).map(([f, c]) => (
            <Dato key={f} titulo={NOMBRE_FUENTE[f] ?? f} valor={n(c)} />
          ))}
        </dl>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">Incidentes recientes</p>
            <select
              className="h-9 rounded-md border border-input bg-card px-2 text-sm"
              aria-label="Filtrar incidentes por tipo"
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
            >
              <option value="">Todos</option>
              {datos.kinds.map((k) => (
                <option key={k} value={k}>
                  {NOMBRE_INCIDENTE[k] ?? k}
                </option>
              ))}
            </select>
          </div>
          <ul className="space-y-1.5">
            {datos.incidents.map((i) => (
              <li key={i.id} className="rounded-md border p-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{NOMBRE_INCIDENTE[i.kind] ?? i.kind}</span>
                  <span className="text-xs text-muted-foreground">
                    {i.count > 1 ? `${n(i.count)} veces · ` : ""}
                    {fecha(i.lastAt)}
                  </span>
                </div>
                {i.detail && <p className="mt-0.5 text-xs text-muted-foreground">{i.detail}</p>}
              </li>
            ))}
            {datos.incidents.length === 0 && (
              <p className="py-1 text-center text-xs text-muted-foreground">Sin incidentes. 🎉</p>
            )}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

function Dato({ titulo, valor, detalle, alerta }: { titulo: string; valor: string; detalle?: string; alerta?: boolean }) {
  return (
    <div className="rounded-md border p-2">
      <dt className="text-xs text-muted-foreground">{titulo}</dt>
      <dd className={`text-base font-semibold ${alerta ? "text-danger-text" : ""}`}>{valor}</dd>
      {detalle && <dd className="text-xs text-muted-foreground">{detalle}</dd>}
    </div>
  );
}
