"use client";

import { AlertTriangle, Copy, Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  DIAS_SEMANA,
  copiarALaborables,
  type DiaSemana,
  type FormBlueprint,
  type Franja,
} from "@/lib/platform/formulario-blueprint";
import { BotonIcono, Campo, FilaInterruptor, Seccion, SelectGuiado, type Actualizar } from "./controles";
import { ZONAS } from "./pestana-negocio";

/** Los rangos de Ajustes → Agenda (mismos que valida el Blueprint). */
const LIMITES = {
  slotMinutes: { min: 10, max: 240 },
  bufferMinutes: { min: 0, max: 120 },
  minNoticeHours: { min: 0, max: 72 },
  maxDaysAhead: { min: 1, max: 60 },
} as const;

/** Pura: ¿se pisan dos franjas de un día? (el servidor lo rechaza igual). */
function solapadas(xs: Franja[]): boolean {
  const o = [...xs].filter((x) => x.start && x.end).sort((a, b) => a.start.localeCompare(b.start));
  return o.some((x, i) => x.start >= x.end || (i > 0 && o[i - 1]!.end > x.start));
}

/** Pestaña «Agenda»: grilla día por día con varias franjas, y lo avanzado. */
export function PestanaAgenda({
  f,
  upd,
  moduloActivo,
  techoAgenda,
}: {
  f: FormBlueprint;
  upd: Actualizar;
  moduloActivo: boolean;
  techoAgenda: boolean;
}) {
  const g = f.agenda;
  const semana = g.weeklyHours;
  const setSemana = (w: Record<DiaSemana, Franja[]>) => upd("agenda", { weeklyHours: w });
  const setDia = (d: DiaSemana, xs: Franja[]) => setSemana({ ...semana, [d]: xs });
  const numero = (k: keyof typeof LIMITES) =>
    function ControlNumero(id: string) {
      return (
        <Input
          id={id}
          type="number"
          min={LIMITES[k].min}
          max={LIMITES[k].max}
          value={g[k]}
          onChange={(e) => upd("agenda", { [k]: Number(e.target.value) } as Partial<FormBlueprint["agenda"]>)}
        />
      );
    };

  return (
    <div className="space-y-4">
      {(!moduloActivo || !techoAgenda) && (
        <p className="flex items-start gap-2 rounded-lg border border-warning-soft bg-warning-tint p-3 text-sm text-warning-text">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {techoAgenda
            ? "El módulo Agenda está apagado para este negocio: la configuración se guarda, pero no se usa hasta encenderlo en Módulos."
            : "Esta instancia no tiene la agenda habilitada: la configuración se guarda, pero no se usa."}
        </p>
      )}

      <Seccion titulo="Horario de atención" descripcion="Cada día puede tener varias franjas (p. ej. mañana y tarde, con almuerzo en medio).">
        <FilaInterruptor titulo="Configurar la agenda" checked={g.usar} onChange={(v) => upd("agenda", { usar: v })} />
        {g.usar && (
          <ul className="divide-y rounded-lg border">
            {DIAS_SEMANA.map(([d, nombre]) => {
              const franjas = semana[d];
              const abierto = franjas.length > 0;
              const mal = solapadas(franjas);
              return (
                <li key={d} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start">
                  <div className="flex w-36 shrink-0 items-center gap-3 pt-1">
                    <Switch
                      size="sm"
                      checked={abierto}
                      label={`${nombre} abierto`}
                      onCheckedChange={(v) => setDia(d, v ? [{ start: "09:00", end: "18:00" }] : [])}
                    />
                    <span className="text-sm font-medium">{nombre}</span>
                  </div>
                  {abierto ? (
                    <div className="flex-1 space-y-2">
                      {franjas.map((x, i) => (
                        <div key={i} className="flex flex-wrap items-center gap-2">
                          <Input
                            type="time"
                            aria-label={`${nombre}: desde`}
                            className="w-32"
                            value={x.start}
                            onChange={(e) => setDia(d, franjas.map((y, j) => (j === i ? { ...y, start: e.target.value } : y)))}
                          />
                          <span className="text-text-3">a</span>
                          <Input
                            type="time"
                            aria-label={`${nombre}: hasta`}
                            className="w-32"
                            value={x.end}
                            onChange={(e) => setDia(d, franjas.map((y, j) => (j === i ? { ...y, end: e.target.value } : y)))}
                          />
                          <BotonIcono etiqueta="Quitar franja" peligro onClick={() => setDia(d, franjas.filter((_, j) => j !== i))}>
                            <X className="h-4 w-4" />
                          </BotonIcono>
                        </div>
                      ))}
                      <div className="flex flex-wrap gap-3 text-xs">
                        <button
                          type="button"
                          disabled={franjas.length >= 6}
                          className="inline-flex items-center gap-1 text-brand-ink hover:underline disabled:opacity-40"
                          onClick={() => {
                            const ultima = franjas[franjas.length - 1];
                            setDia(d, [...franjas, { start: ultima?.end && ultima.end < "22:00" ? sumarHora(ultima.end) : "14:00", end: "18:00" }]);
                          }}
                        >
                          <Plus className="h-3.5 w-3.5" /> Agregar franja
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-brand-ink hover:underline"
                          onClick={() => setSemana(copiarALaborables(semana, d))}
                        >
                          <Copy className="h-3.5 w-3.5" /> Copiar a lunes–viernes
                        </button>
                      </div>
                      {mal && <p className="text-xs text-danger-text">Las franjas se pisan o una termina antes de empezar.</p>}
                    </div>
                  ) : (
                    <span className="pt-1.5 text-sm text-text-3">Cerrado</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Seccion>

      {g.usar && (
        <Seccion titulo="Citas">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Campo etiqueta="Duración (min)">{numero("slotMinutes")}</Campo>
            <Campo etiqueta="Descanso entre citas (min)">{numero("bufferMinutes")}</Campo>
            <Campo etiqueta="Anticipación mínima (h)">{numero("minNoticeHours")}</Campo>
            <Campo etiqueta="Días a futuro">{numero("maxDaysAhead")}</Campo>
            <Campo etiqueta="Zona de la agenda" className="sm:col-span-2">
              {(id) => (
                <SelectGuiado id={id} valor={g.timezone} opciones={ZONAS} onChange={(v) => upd("agenda", { timezone: v })} placeholderOtro="IANA" />
              )}
            </Campo>
            <Campo
              etiqueta="Enlace fijo de reunión (opcional)"
              className="sm:col-span-2"
              ayuda="https:// — Meet, Zoom o Jitsi. Vacío: citas sin enlace. Zoom y Google con cuenta los conecta el negocio."
            >
              {(id) => (
                <Input
                  id={id}
                  type="url"
                  placeholder="https://meet.google.com/abc-defg-hij"
                  value={g.meetingLink}
                  onChange={(e) => upd("agenda", { meetingLink: e.target.value })}
                />
              )}
            </Campo>
          </div>
        </Seccion>
      )}
    </div>
  );
}

/** «13:00» → «14:00» (sugerir la franja siguiente tras el almuerzo). */
function sumarHora(h: string): string {
  const [hh, mm] = h.split(":").map(Number);
  const n = Math.min((hh ?? 0) + 1, 22);
  return `${String(n).padStart(2, "0")}:${String(mm ?? 0).padStart(2, "0")}`;
}
