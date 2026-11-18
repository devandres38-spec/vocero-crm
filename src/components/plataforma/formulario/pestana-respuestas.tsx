"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { normalizarAtajo, TEXTO_MAX, TOPE_RESPUESTAS } from "@/lib/respuestas-rapidas";
import type { FormBlueprint } from "@/lib/platform/formulario-blueprint";
import { BotonIcono, Pastillas, Seccion, type Actualizar } from "./controles";

/** Pestaña «Respuestas rápidas»: `/atajo` → texto, con `{nombre}`. */
export function PestanaRespuestas({ f, upd }: { f: FormBlueprint; upd: Actualizar }) {
  const xs = f.quickReplies.entries;
  const set = (entries: FormBlueprint["quickReplies"]["entries"]) => upd("quickReplies", { entries });
  return (
    <Seccion
      titulo={`Respuestas rápidas (${xs.length})`}
      descripcion="El equipo escribe «/atajo» en el chat y se inserta el texto. {nombre} se cambia por el primer nombre del contacto."
      accion={
        <Button type="button" size="sm" variant="outline" disabled={xs.length >= TOPE_RESPUESTAS} onClick={() => set([...xs, { shortcut: "", text: "" }])}>
          <Plus className="mr-1 h-4 w-4" /> Respuesta
        </Button>
      }
    >
      <div className="space-y-1">
        <Pastillas
          etiqueta="Cómo se aplica"
          valor={f.quickReplies.mode}
          onChange={(mode) => upd("quickReplies", { mode })}
          opciones={[
            { value: "merge", label: "Agregar y actualizar" },
            { value: "exact", label: "Dejar exactamente esto" },
          ]}
        />
      </div>
      {xs.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-text-3">Sin respuestas rápidas.</p>
      ) : (
        <ul className="space-y-3">
          {xs.map((r, i) => {
            const atajo = normalizarAtajo(r.shortcut);
            return (
              <li key={i} className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-text-3">/</span>
                  <Input
                    aria-label="Atajo"
                    className="max-w-56 font-mono"
                    placeholder="pagos"
                    value={r.shortcut}
                    onChange={(e) => set(xs.map((x, j) => (j === i ? { ...x, shortcut: e.target.value } : x)))}
                  />
                  {r.shortcut && atajo !== r.shortcut && <span className="font-mono text-xs text-text-3">se guarda como /{atajo || "—"}</span>}
                  <span className="flex-1" />
                  <BotonIcono etiqueta="Quitar" peligro onClick={() => set(xs.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </BotonIcono>
                </div>
                <Textarea
                  aria-label="Texto"
                  rows={3}
                  maxLength={TEXTO_MAX}
                  placeholder="Hola {nombre}, recibimos efectivo, tarjeta y Nequi."
                  value={r.text}
                  onChange={(e) => set(xs.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                />
              </li>
            );
          })}
        </ul>
      )}
    </Seccion>
  );
}

/**
 * Pestaña «JSON avanzado»: lo que se va a mandar, tal cual (lo mismo que
 * mandaría una IA por el MCP), e importar un Blueprint al formulario.
 */
export function PestanaJson({
  vista,
  onImportar,
}: {
  vista: Record<string, unknown>;
  onImportar: (bp: unknown) => string | null;
}) {
  const [texto, setTexto] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <Seccion titulo="Lo que se va a enviar" descripcion="El OrganizationBlueprint exacto que recibirá la API.">
        <pre className="max-h-[420px] overflow-auto rounded-lg border bg-subtle p-3 font-mono text-xs">{JSON.stringify(vista, null, 2)}</pre>
      </Seccion>
      <Seccion titulo="Importar un Blueprint" descripcion="Pega un Blueprint (de otro negocio, de una plantilla o de una IA) para llenar el formulario. No se guarda hasta que lo envíes.">
        <Textarea aria-label="Blueprint a importar" rows={8} className="font-mono text-xs" value={texto} onChange={(e) => setTexto(e.target.value)} />
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!texto.trim()}
            onClick={() => {
              try {
                const error = onImportar(JSON.parse(texto));
                setMsg(error ?? "Importado al formulario. Revisa las pestañas antes de enviar.");
              } catch {
                setMsg("No es un JSON válido.");
              }
            }}
          >
            Llenar el formulario
          </Button>
          {msg && <span className="text-xs text-text-3">{msg}</span>}
        </div>
      </Seccion>
    </div>
  );
}
