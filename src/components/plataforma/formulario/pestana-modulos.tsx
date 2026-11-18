"use client";

import { ArrowDown, ArrowUp, Lock, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FormBlueprint, TechoForm } from "@/lib/platform/formulario-blueprint";
import { BotonIcono, FilaInterruptor, Seccion, mover, type Actualizar } from "./controles";

const CANALES_OPCIONALES = [
  { id: "instagram", titulo: "Instagram", descripcion: "Mensajes directos de Instagram en la misma bandeja." },
  { id: "messenger", titulo: "Messenger", descripcion: "Mensajes de la página de Facebook." },
  { id: "tiktok", titulo: "TikTok", descripcion: "Mensajes directos de TikTok." },
];

/** Pestaña «Módulos»: interruptores dentro del techo de la instancia. */
export function PestanaModulos({ f, upd, techo }: { f: FormBlueprint; upd: Actualizar; techo: TechoForm }) {
  const nota = "No disponible en esta instancia";
  const canal = (id: string, v: boolean) =>
    upd("modules", { channels: v ? [...f.modules.channels.filter((c) => c !== id), id] : f.modules.channels.filter((c) => c !== id) });
  return (
    <Seccion
      titulo="Módulos del negocio"
      descripcion="Solo la agencia los enciende o apaga. Lo que esta instancia no permite aparece bloqueado (lo decide el despliegue)."
    >
      <div className="divide-y">
        <FilaInterruptor titulo="WhatsApp" descripcion="El canal principal. Siempre encendido." checked disabled onChange={() => undefined} nota="Siempre" />
        <FilaInterruptor
          titulo="Agenda (citas)"
          descripcion="Horarios, huecos libres y citas que agenda el agente o el equipo."
          checked={techo.agenda && f.modules.agenda}
          disabled={!techo.agenda}
          nota={techo.agenda ? undefined : nota}
          onChange={(v) => upd("modules", { agenda: v })}
        />
        <FilaInterruptor
          titulo="Atribución de anuncios"
          descripcion="De qué anuncio llegó cada conversación y el reporte de conversiones a Meta."
          checked={techo.atribucion && f.modules.atribucion}
          disabled={!techo.atribucion}
          nota={techo.atribucion ? undefined : nota}
          onChange={(v) => upd("modules", { atribucion: v })}
        />
        {CANALES_OPCIONALES.map((c) => {
          const permitido = techo.channels.includes(c.id);
          return (
            <FilaInterruptor
              key={c.id}
              titulo={c.titulo}
              descripcion={c.descripcion}
              checked={permitido && f.modules.channels.includes(c.id)}
              disabled={!permitido}
              nota={permitido ? undefined : nota}
              onChange={(v) => canal(c.id, v)}
            />
          );
        })}
      </div>
    </Seccion>
  );
}

/** Pestaña «Pipeline»: etapas abiertas reordenables + anclas fijas. */
export function PestanaPipeline({ f, upd }: { f: FormBlueprint; upd: Actualizar }) {
  const etapas = f.pipeline.stages;
  const set = (stages: string[]) => upd("pipeline", { stages });
  return (
    <Seccion
      titulo="Etapas del pipeline"
      descripcion="Las etapas abiertas, en orden. Una etapa con leads que quites se conserva (y se avisa): nunca se pierden datos."
      accion={
        <Button type="button" size="sm" variant="outline" disabled={etapas.length >= 20} onClick={() => set([...etapas, ""])}>
          <Plus className="mr-1 h-4 w-4" /> Etapa
        </Button>
      }
    >
      <ol className="space-y-2">
        {etapas.map((e, i) => (
          <li key={i} className="flex items-center gap-2 rounded-lg border bg-background p-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-subtle text-xs font-semibold text-text-3">
              {i + 1}
            </span>
            <Input
              aria-label={`Etapa ${i + 1}`}
              value={e}
              maxLength={60}
              placeholder="Nombre de la etapa"
              onChange={(ev) => set(etapas.map((x, j) => (j === i ? ev.target.value : x)))}
            />
            <BotonIcono etiqueta="Subir" disabled={i === 0} onClick={() => set(mover(etapas, i, -1))}>
              <ArrowUp className="h-4 w-4" />
            </BotonIcono>
            <BotonIcono etiqueta="Bajar" disabled={i === etapas.length - 1} onClick={() => set(mover(etapas, i, 1))}>
              <ArrowDown className="h-4 w-4" />
            </BotonIcono>
            <BotonIcono etiqueta="Quitar" peligro disabled={etapas.length <= 1} onClick={() => set(etapas.filter((_, j) => j !== i))}>
              <Trash2 className="h-4 w-4" />
            </BotonIcono>
          </li>
        ))}
        {(["Cliente (ganado)", "Perdido"] as const).map((ancla) => (
          <li key={ancla} className="flex items-center gap-2 rounded-lg border border-dashed bg-subtle p-2 text-sm text-text-3">
            <Lock className="ml-1.5 h-4 w-4" />
            <span className="flex-1">{ancla}</span>
            <span className="text-xs">Ancla fija</span>
          </li>
        ))}
      </ol>
    </Seccion>
  );
}
