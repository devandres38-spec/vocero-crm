"use client";

import { ArrowDown, ArrowUp, MessageSquareText, Plus, Text, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { HERRAMIENTAS, ROLES } from "@/lib/agent-roles";
import { entradaKbCompleta, nuevoUid, type EntradaKb, type FormBlueprint } from "@/lib/platform/formulario-blueprint";
import { cn } from "@/lib/utils";
import { BotonIcono, Campo, FilaInterruptor, Pastillas, SELECT, Seccion, mover, type Actualizar } from "./controles";

/** Pestaña «Agente»: identidad, rol, herramientas e instrucciones. */
export function PestanaAgente({ f, upd, agendaActiva }: { f: FormBlueprint; upd: Actualizar; agendaActiva: boolean }) {
  const a = f.agent;
  const herramienta = (clave: string, v: boolean) =>
    upd("agent", { tools: v ? [...a.tools.filter((x) => x !== clave), clave] : a.tools.filter((x) => x !== clave) });
  return (
    <div className="space-y-4">
      <Seccion titulo="Identidad">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Nombre del agente">
            {(id) => <Input id={id} maxLength={60} value={a.name} placeholder="Sofía" onChange={(e) => upd("agent", { name: e.target.value })} />}
          </Campo>
          <Campo etiqueta="Rol">
            {(id) => (
              <select id={id} className={SELECT} value={a.role} onChange={(e) => upd("agent", { role: e.target.value })}>
                <option value="">Sin cambiar</option>
                {Object.values(ROLES).map((r) => (
                  <option key={r.clave} value={r.clave}>
                    {r.etiqueta}
                  </option>
                ))}
              </select>
            )}
          </Campo>
          <Campo etiqueta="Tono" className="sm:col-span-2">
            {(id) => (
              <Input id={id} maxLength={500} value={a.tone} placeholder="Cálido y profesional" onChange={(e) => upd("agent", { tone: e.target.value })} />
            )}
          </Campo>
          <Campo etiqueta="Saludo" className="sm:col-span-2">
            {(id) => <Textarea id={id} rows={2} maxLength={1000} value={a.greeting} onChange={(e) => upd("agent", { greeting: e.target.value })} />}
          </Campo>
        </div>
      </Seccion>

      <Seccion titulo="Herramientas" descripcion="Qué puede hacer el agente además de conversar.">
        <FilaInterruptor
          titulo="Todas las herramientas"
          descripcion="Incluye las que se agreguen en versiones futuras."
          checked={a.todas}
          onChange={(v) => upd("agent", { todas: v, tools: v ? [] : HERRAMIENTAS.filter((h) => h.fija).map((h) => h.clave) })}
        />
        {!a.todas && (
          <div className="divide-y border-t">
            {HERRAMIENTAS.map((h) => (
              <FilaInterruptor
                key={h.clave}
                titulo={h.etiqueta}
                descripcion={h.descripcion}
                checked={h.fija === true || a.tools.includes(h.clave)}
                disabled={h.fija === true}
                nota={h.fija ? "Siempre" : h.agenda && !agendaActiva ? "Requiere agenda" : undefined}
                onChange={(v) => herramienta(h.clave, v)}
              />
            ))}
          </div>
        )}
      </Seccion>

      <Seccion titulo="Instrucciones">
        <Campo etiqueta="Cómo trabaja" ayuda={`${a.instructions.length} / 8000`}>
          {(id) => (
            <Textarea id={id} rows={8} maxLength={8000} value={a.instructions} onChange={(e) => upd("agent", { instructions: e.target.value })} />
          )}
        </Campo>
        <Campo etiqueta="Reglas de escalado" ayuda="Cuándo pasar la conversación a una persona.">
          {(id) => (
            <Textarea
              id={id}
              rows={4}
              maxLength={4000}
              value={a.escalationRules}
              onChange={(e) => upd("agent", { escalationRules: e.target.value })}
            />
          )}
        </Campo>
      </Seccion>
    </div>
  );
}

/** Pestaña «Conocimiento»: tarjetas multi-línea de pregunta/respuesta y bloques. */
export function PestanaConocimiento({ f, upd }: { f: FormBlueprint; upd: Actualizar }) {
  const entradas = f.knowledge.entries;
  const set = (entries: EntradaKb[]) => upd("knowledge", { entries });
  const cambiar = (i: number, e: EntradaKb) => set(entradas.map((x, j) => (j === i ? e : x)));
  return (
    <Seccion
      titulo={`Conocimiento (${entradas.length})`}
      descripcion="Lo que el agente sabe del negocio: precios, políticas, ubicación… Cada tarjeta admite varias líneas."
      accion={
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => set([...entradas, { kind: "qa", question: "", answer: "", uid: nuevoUid() }])}>
            <Plus className="mr-1 h-4 w-4" /> Pregunta
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => set([...entradas, { kind: "block", content: "", uid: nuevoUid() }])}>
            <Plus className="mr-1 h-4 w-4" /> Bloque
          </Button>
        </div>
      }
    >
      <div className="space-y-1">
        <Pastillas
          etiqueta="Cómo se aplica"
          valor={f.knowledge.mode}
          onChange={(mode) => upd("knowledge", { mode })}
          opciones={[
            { value: "merge", label: "Agregar y actualizar" },
            { value: "exact", label: "Dejar exactamente esto" },
          ]}
        />
        <p className="text-xs text-text-3">
          {f.knowledge.mode === "merge"
            ? "Nunca borra: agrega lo nuevo y actualiza respuestas de preguntas que ya existen."
            : "Borra del negocio lo que no esté en esta lista."}
        </p>
      </div>
      {entradas.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-text-3">Sin entradas todavía.</p>
      ) : (
        <ul className="space-y-3">
          {entradas.map((e, i) => (
            <li
              key={e.uid ?? `kb-${i}`}
              className={cn("space-y-2 rounded-lg border p-3", !entradaKbCompleta(e) && "border-warning-soft bg-warning-tint")}
            >
              <div className="flex items-center gap-2">
                {e.kind === "qa" ? <MessageSquareText className="h-4 w-4 text-text-3" /> : <Text className="h-4 w-4 text-text-3" />}
                <span className="flex-1 text-xs font-medium text-text-3">
                  {e.kind === "qa" ? "Pregunta y respuesta" : "Bloque de texto"}
                  {!entradaKbCompleta(e) && <span className="ml-2 text-warning-text">· incompleta: no se guardará</span>}
                </span>
                <BotonIcono etiqueta="Subir" disabled={i === 0} onClick={() => set(mover(entradas, i, -1))}>
                  <ArrowUp className="h-4 w-4" />
                </BotonIcono>
                <BotonIcono etiqueta="Bajar" disabled={i === entradas.length - 1} onClick={() => set(mover(entradas, i, 1))}>
                  <ArrowDown className="h-4 w-4" />
                </BotonIcono>
                <BotonIcono etiqueta="Quitar" peligro onClick={() => set(entradas.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4" />
                </BotonIcono>
              </div>
              {e.kind === "qa" ? (
                <>
                  <Input
                    aria-label="Pregunta"
                    placeholder="¿Hacen domicilios?"
                    maxLength={500}
                    value={e.question}
                    onChange={(ev) => cambiar(i, { ...e, question: ev.target.value })}
                  />
                  <Textarea
                    aria-label="Respuesta"
                    rows={3}
                    maxLength={4000}
                    placeholder="Sí, en toda la ciudad…"
                    value={e.answer}
                    onChange={(ev) => cambiar(i, { ...e, answer: ev.target.value })}
                  />
                </>
              ) : (
                <Textarea
                  aria-label="Bloque"
                  rows={4}
                  maxLength={8000}
                  value={e.content}
                  onChange={(ev) => cambiar(i, { ...e, content: ev.target.value })}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </Seccion>
  );
}
