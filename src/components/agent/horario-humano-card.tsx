"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useRegion } from "@/lib/region-context";

/**
 * 073-B (D6, decisión #7) — Ajustes del horario en que hay PERSONAS para
 * atender el chat. Con él, el agente no promete «ya te escribe un asesor»
 * fuera de horario. Una franja por día (el formato admite más; la API y el
 * Blueprint las aceptan).
 */

type Dia = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
type Franja = { start: string; end: string };
type Horario = { weeklyHours: Partial<Record<Dia, Franja[]>>; colombianHolidays: boolean };

const DIAS: { clave: Dia; nombre: string }[] = [
  { clave: "mon", nombre: "Lunes" },
  { clave: "tue", nombre: "Martes" },
  { clave: "wed", nombre: "Miércoles" },
  { clave: "thu", nombre: "Jueves" },
  { clave: "fri", nombre: "Viernes" },
  { clave: "sat", nombre: "Sábado" },
  { clave: "sun", nombre: "Domingo" },
];

const POR_DEFECTO: Horario = {
  weeklyHours: Object.fromEntries(
    (["mon", "tue", "wed", "thu", "fri"] as Dia[]).map((d) => [d, [{ start: "08:00", end: "18:00" }]])
  ),
  colombianHolidays: true,
};

type Respuesta = {
  humanHours: Horario | null;
  timezone: string;
  ahora: { humanAvailable?: boolean; nextOpenAt?: string | null };
};

export function HorarioHumanoCard() {
  const { locale } = useRegion();
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [horario, setHorario] = useState<Horario | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/settings/human-hours")
      .then((r) => (r.ok ? (r.json() as Promise<Respuesta>) : null))
      .then((d) => {
        if (!d) return;
        setDatos(d);
        setHorario(d.humanHours);
      })
      .catch(() => null);
  }, []);

  async function guardar(siguiente: Horario | null) {
    setGuardando(true);
    setError(null);
    const r = await fetch("/api/settings/human-hours", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ humanHours: siguiente }),
    }).catch(() => null);
    setGuardando(false);
    if (!r?.ok) {
      setError("No se pudo guardar: revisa que cada franja termine después de empezar.");
      return;
    }
    const d = (await r.json()) as Respuesta;
    setDatos(d);
    setHorario(d.humanHours);
  }

  function cambiarDia(dia: Dia, franja: Franja | null) {
    if (!horario) return;
    const weeklyHours = { ...horario.weeklyHours };
    if (franja) weeklyHours[dia] = [franja];
    else delete weeklyHours[dia];
    setHorario({ ...horario, weeklyHours });
  }

  const estado = datos?.ahora;
  const vuelve =
    estado?.nextOpenAt &&
    new Intl.DateTimeFormat(locale, {
      weekday: "long",
      hour: "numeric",
      minute: "2-digit",
      timeZone: datos?.timezone,
    }).format(new Date(estado.nextOpenAt));

  return (
    <Card aria-busy={guardando} className="lg:col-span-2" data-testid="horario-humano">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Horario de atención humana</CardTitle>
            <CardDescription>
              Cuándo hay personas del equipo para atender el chat. Fuera de este horario el agente no
              promete que un asesor contestará enseguida.
            </CardDescription>
          </div>
          <Switch
            checked={horario !== null}
            disabled={guardando || !datos}
            label="Usar horario de atención humana"
            onCheckedChange={(on) => void guardar(on ? (horario ?? POR_DEFECTO) : null)}
          />
        </div>
      </CardHeader>
      {horario && (
        <CardContent className="space-y-3">
          <ul className="space-y-1.5">
            {DIAS.map(({ clave, nombre }) => {
              const franja = horario.weeklyHours[clave]?.[0] ?? null;
              return (
                <li key={clave} className="flex flex-wrap items-center gap-2 text-sm">
                  <label className="flex w-28 cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={franja !== null}
                      onChange={(e) => cambiarDia(clave, e.target.checked ? { start: "08:00", end: "18:00" } : null)}
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                    {nombre}
                  </label>
                  {franja ? (
                    <>
                      <input
                        type="time"
                        aria-label={`${nombre}: desde`}
                        value={franja.start}
                        onChange={(e) => cambiarDia(clave, { ...franja, start: e.target.value })}
                        className="rounded-md border border-border-strong bg-background px-2 py-1 text-[13px]"
                      />
                      <span className="text-text-3">a</span>
                      <input
                        type="time"
                        aria-label={`${nombre}: hasta`}
                        value={franja.end}
                        onChange={(e) => cambiarDia(clave, { ...franja, end: e.target.value })}
                        className="rounded-md border border-border-strong bg-background px-2 py-1 text-[13px]"
                      />
                    </>
                  ) : (
                    <span className="text-text-3">Sin personas</span>
                  )}
                </li>
              );
            })}
          </ul>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={horario.colombianHolidays}
              onChange={(e) => setHorario({ ...horario, colombianHolidays: e.target.checked })}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            Los festivos de Colombia no hay atención (Ley Emiliani)
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-text-3">
              {estado?.humanAvailable
                ? "Ahora mismo hay personas atendiendo."
                : vuelve
                  ? `Ahora no hay personas; vuelven el ${vuelve}.`
                  : "Con este horario no hay personas en los próximos días."}{" "}
              Zona: {datos?.timezone}.
            </p>
            <Button size="sm" disabled={guardando} onClick={() => void guardar(horario)}>
              Guardar horario
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-danger-text">
              {error}
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
