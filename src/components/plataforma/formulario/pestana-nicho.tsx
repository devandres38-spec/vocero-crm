"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TIPOS_CAMPO, TOPE_CAMPOS, type TipoCampo } from "@/lib/ficha-campos";
import { nuevoUid, type CampoFichaForm, type FormBlueprint, type ModoFormulario } from "@/lib/platform/formulario-blueprint";
import { claveSugerida, ETIQUETA_TIPO } from "@/components/settings/ficha-campos-client";
import { PACK_IDS, PACKS } from "@/verticals/registro";
import { BotonIcono, Campo, SELECT, Seccion, mover, type Actualizar } from "./controles";

/**
 * 072 (US1, FR-022) — Pestaña «Nicho y ficha» del formulario de `/platform`.
 *
 * - Elegir el pack cambia cómo se ve el negocio (menú, vocabulario, Inicio);
 *   NO aplica su plantilla.
 * - «Cargar plantilla» trae la semilla del pack al formulario: al crear,
 *   rellena todo menos nombre, dirección, región y módulos; al editar, marca
 *   las pestañas que cambian para revisarlas con «Revisar cambios» antes de
 *   guardar.
 */
export function PestanaNicho({
  f,
  upd,
  modo,
  onCargarPlantilla,
}: {
  f: FormBlueprint;
  upd: Actualizar;
  modo: ModoFormulario;
  onCargarPlantilla: (packId: string) => void;
}) {
  const [plantilla, setPlantilla] = useState<string>(f.vertical.pack === "default" ? "clinica-salud" : f.vertical.pack);
  const actual = PACKS[f.vertical.pack as keyof typeof PACKS] ?? PACKS.default;
  const campos = f.fichaFields.fields;
  const poner = (fields: CampoFichaForm[]) => upd("fichaFields", { fields });

  return (
    <div className="space-y-4">
      <Seccion
        titulo="Plantilla de nicho"
        descripcion={
          modo === "crear"
            ? "Empieza desde un nicho: etapas, agente, ficha, conocimiento, respuestas rápidas y apariencia ya pensados para ese negocio. Todo se puede ajustar."
            : "Carga la plantilla de un nicho en este formulario. No se guarda nada hasta que revises y guardes; el conocimiento y las respuestas rápidas se suman a lo que ya hay."
        }
      >
        <div className="flex flex-wrap items-end gap-2">
          <Campo etiqueta="Plantilla" className="min-w-[14rem] flex-1">
            {(id) => (
              <select id={id} className={SELECT} value={plantilla} onChange={(e) => setPlantilla(e.target.value)}>
                {PACK_IDS.filter((p) => p !== "default").map((p) => (
                  <option key={p} value={p}>
                    {PACKS[p].label}
                  </option>
                ))}
              </select>
            )}
          </Campo>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const hayAlgo = f.agent.name.trim() !== "" || f.knowledge.entries.length > 0 || campos.length > 0;
              if (modo === "crear" && hayAlgo && !window.confirm("La plantilla reemplaza el agente, las etapas y la ficha que llevas. ¿Continuar?")) return;
              onCargarPlantilla(plantilla);
            }}
          >
            <Sparkles className="mr-1.5 h-4 w-4" /> {modo === "crear" ? "Empezar desde esta plantilla" : "Cargar plantilla"}
          </Button>
        </div>
        <p className="text-xs text-text-3">{PACKS[plantilla as keyof typeof PACKS]?.description}</p>
      </Seccion>

      <Seccion
        titulo="Nicho del negocio"
        descripcion="Cómo se ve el negocio por dentro: vocabulario, menú e Inicio. Cambiarlo no toca su configuración."
      >
        <Campo etiqueta="Vertical Pack" ayuda={actual.description}>
          {(id) => (
            <select id={id} className={SELECT} value={f.vertical.pack} onChange={(e) => upd("vertical", { pack: e.target.value })}>
              {PACK_IDS.map((p) => (
                <option key={p} value={p}>
                  {PACKS[p].label}
                </option>
              ))}
            </select>
          )}
        </Campo>
        {actual.modulosRecomendados.length > 0 && (
          <p className="text-xs text-text-3">Módulos recomendados: {actual.modulosRecomendados.join(", ")} (llegan en próximas versiones).</p>
        )}
      </Seccion>

      <Seccion
        titulo="Campos de la ficha"
        descripcion="Lo que el agente pide a cada cliente, en este orden, y lo que la Bandeja muestra con su control. La clave y el tipo de un campo ya guardado no cambian; quitar uno no borra lo ya anotado."
        accion={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={campos.length >= TOPE_CAMPOS}
            onClick={() => poner([...campos, { key: "", label: "", type: "text", uid: nuevoUid() }])}
          >
            <Plus className="mr-1 h-4 w-4" /> Campo
          </Button>
        }
      >
        {campos.length === 0 ? (
          <p className="text-sm text-text-2">Sin campos: la ficha es libre.</p>
        ) : (
          <ol className="space-y-2">
            {campos.map((c, i) => (
              // A-2 (auditoría 072-A) — `uid` estable: la clave cambia con cada
              // tecla del nombre y como `key` de React remontaba el input.
              <li key={c.uid ?? `${i}`} className="space-y-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    aria-label="Nombre del campo"
                    className="min-w-[10rem] flex-1"
                    value={c.label}
                    maxLength={60}
                    placeholder="Fecha del evento"
                    onChange={(e) => {
                      const label = e.target.value;
                      const key = c.key === "" || c.key === claveSugerida(c.label) ? claveSugerida(label) : c.key;
                      poner(campos.map((x, j) => (j === i ? { ...x, label, key } : x)));
                    }}
                  />
                  <select
                    aria-label="Tipo"
                    className={`${SELECT} w-auto`}
                    value={c.type}
                    // B-3 (auditoría 072-A) — El tipo de un campo que ya existe en
                    // el negocio no cambia (el servidor lo rechazaría igual).
                    disabled={modo === "editar" && c.guardado === true}
                    title={modo === "editar" && c.guardado ? "El tipo de un campo guardado no cambia" : undefined}
                    onChange={(e) => {
                      const type = e.target.value as TipoCampo;
                      poner(
                        campos.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                type,
                                ...(type === "select"
                                  ? { options: x.options ?? ["Opción 1"], opcionesTexto: x.opcionesTexto ?? (x.options ?? ["Opción 1"]).join("\n") }
                                  : { options: undefined, opcionesTexto: undefined }),
                              }
                            : x
                        )
                      );
                    }}
                  >
                    {TIPOS_CAMPO.map((t) => (
                      <option key={t} value={t}>
                        {ETIQUETA_TIPO[t]}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      className="accent-primary"
                      checked={c.required === true}
                      onChange={(e) => poner(campos.map((x, j) => (j === i ? { ...x, required: e.target.checked || undefined } : x)))}
                    />
                    Obligatorio
                  </label>
                  <BotonIcono etiqueta="Subir" onClick={() => poner(mover(campos, i, -1))} disabled={i === 0}>
                    <ArrowUp className="h-4 w-4" />
                  </BotonIcono>
                  <BotonIcono etiqueta="Bajar" onClick={() => poner(mover(campos, i, 1))} disabled={i === campos.length - 1}>
                    <ArrowDown className="h-4 w-4" />
                  </BotonIcono>
                  <BotonIcono etiqueta="Quitar campo" peligro onClick={() => poner(campos.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </BotonIcono>
                </div>
                {c.type === "select" && (
                  // A-3 (auditoría 072-A) — Se guarda el texto CRUDO y se parsea al
                  // enviar: parsear en cada tecla borraba la coma (o el salto)
                  // recién escrito y no dejaba escribir la segunda opción.
                  <textarea
                    aria-label="Opciones (una por línea)"
                    rows={3}
                    className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
                    value={c.opcionesTexto ?? (c.options ?? []).join("\n")}
                    placeholder={"Boda\nCorporativo\nOtro"}
                    onChange={(e) => poner(campos.map((x, j) => (j === i ? { ...x, opcionesTexto: e.target.value } : x)))}
                  />
                )}
                <Input
                  aria-label="Indicación para el agente"
                  value={c.description ?? ""}
                  maxLength={160}
                  placeholder="Indicación para el agente (opcional)"
                  onChange={(e) => poner(campos.map((x, j) => (j === i ? { ...x, description: e.target.value || undefined } : x)))}
                />
                <p className="font-mono text-[11px] text-text-3">clave: {c.key || "—"}</p>
              </li>
            ))}
          </ol>
        )}
      </Seccion>
    </div>
  );
}
