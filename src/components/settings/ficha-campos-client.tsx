"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CLAVE_CAMPO_RE,
  CLAVES_RESERVADAS,
  fichaFieldsSchema,
  opcionesDeTexto,
  TIPOS_CAMPO,
  TOPE_CAMPOS,
  type FichaField,
  type TipoCampo,
} from "@/lib/ficha-campos";

/**
 * 072 (FR-013) — Ajustes → Ficha: qué datos quiere este negocio de cada
 * cliente. El agente los pide en este orden (uno a la vez, los obligatorios
 * primero en su lista de pendientes) y la ficha de la Bandeja los muestra con
 * su control. La clave y el tipo de un campo ya guardado no cambian: lo ya
 * anotado dejaría de encajar.
 */

export const ETIQUETA_TIPO: Record<TipoCampo, string> = {
  text: "Texto",
  number: "Número",
  date: "Fecha",
  select: "Lista de opciones",
  boolean: "Sí / No",
};

/**
 * `uid`: identidad ESTABLE de la fila en el editor (A-2, auditoría 072-A).
 * La `key` del campo cambia con cada tecla del nombre mientras la fila es
 * nueva; usarla como `key` de React remontaba el input y se perdía el foco.
 */
export type Fila = FichaField & { uid: string; nueva: boolean; opcionesTexto: string };

let contadorUid = 0;
/** Un id local de fila: no viaja al servidor ni se guarda. */
export function nuevoUid(): string {
  contadorUid += 1;
  return `fila-${contadorUid}`;
}


/** «Tratamiento de interés» → `tratamiento_de_interes`. */
export function claveSugerida(etiqueta: string): string {
  const base = etiqueta
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return /^[a-z]/.test(base) ? base : `campo_${base}`.slice(0, 40);
}

/** Puro: las filas del editor a lo que se guarda. */
export function aCampos(filas: Fila[]): FichaField[] {
  return filas.map((f) => {
    const opciones = opcionesDeTexto(f.opcionesTexto);
    return {
      key: f.key.trim(),
      label: f.label.trim(),
      type: f.type,
      ...(f.type === "select" ? { options: opciones } : {}),
      ...(f.required ? { required: true } : {}),
      ...(f.description?.trim() ? { description: f.description.trim() } : {}),
    };
  });
}

export function aFila(f: FichaField, nueva = false): Fila {
  return { ...f, uid: nuevoUid(), nueva, opcionesTexto: (f.options ?? []).join("\n") };
}

export function FichaCamposClient() {
  const [guardadas, setGuardadas] = useState<FichaField[] | null>(null);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [puedeEditar, setPuedeEditar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorCarga, setErrorCarga] = useState(false);

  const cargar = useCallback(async () => {
    setErrorCarga(false);
    const res = await fetch("/api/settings/ficha-fields").catch(() => null);
    const d = res?.ok
      ? ((await res.json().catch(() => null)) as { fields: FichaField[]; puedeEditar: boolean } | null)
      : null;
    // M-10 (auditoría 072-A) — Si no carga, se dice (y se puede reintentar)
    // en vez de quedarse en «Cargando…» para siempre.
    if (!d || !Array.isArray(d.fields)) {
      setErrorCarga(true);
      return;
    }
    setGuardadas(d.fields);
    setFilas(d.fields.map((f) => aFila(f)));
    setPuedeEditar(d.puedeEditar);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const cambiar = (i: number, cambio: Partial<Fila>) =>
    setFilas((xs) =>
      xs.map((f, j) => {
        if (j !== i) return f;
        const n = { ...f, ...cambio };
        // Mientras sea nueva, la clave sigue a la etiqueta.
        if (f.nueva && cambio.label !== undefined && (f.key === "" || f.key === claveSugerida(f.label))) {
          n.key = claveSugerida(cambio.label);
        }
        return n;
      })
    );

  const mover = (i: number, d: -1 | 1) =>
    setFilas((xs) => {
      const j = i + d;
      if (j < 0 || j >= xs.length) return xs;
      const copia = [...xs];
      [copia[i], copia[j]] = [copia[j]!, copia[i]!];
      return copia;
    });

  function quitar(i: number) {
    const f = filas[i];
    if (f && !f.nueva) {
      setAviso("Los datos ya guardados de ese campo no se borran: pasan a «Otros datos» en la ficha.");
    }
    setFilas((xs) => xs.filter((_, j) => j !== i));
  }

  async function guardar() {
    setError(null);
    const campos = aCampos(filas);
    const v = fichaFieldsSchema.safeParse(campos);
    if (!v.success) {
      const i = v.error.issues[0];
      const fila = typeof i?.path[0] === "number" ? campos[i.path[0]] : null;
      setError(`Revisa ${fila ? `«${fila.label || fila.key || "el campo nuevo"}»` : "los campos"}: ${mensaje(i?.message)}`);
      return;
    }
    setGuardando(true);
    const res = await fetch("/api/settings/ficha-fields", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fields: v.data }),
    }).catch(() => null);
    setGuardando(false);
    if (!res?.ok) {
      const d = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(d?.error?.message ?? "No se pudo guardar. Revisa la conexión.");
      return;
    }
    setAviso(null);
    void cargar();
  }

  const sinCambios = guardadas !== null && JSON.stringify(aCampos(filas)) === JSON.stringify(guardadas);
  const obligatorios = filas.filter((f) => f.required);

  return (
    <div className="max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Campos de la ficha</CardTitle>
          <CardDescription>
            Los datos que tu negocio necesita de cada cliente. El agente los va pidiendo uno a la vez,
            en este orden, sin repetir lo que ya le dijeron; en la Bandeja salen arriba de la ficha con
            su control. Lo que el agente anote fuera de esta lista sigue apareciendo en «Otros datos».
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {guardadas === null && errorCarga ? (
            <div role="alert" className="flex items-center gap-3 text-sm text-text-2">
              No se pudieron cargar los campos.
              <Button variant="outline" size="sm" onClick={() => void cargar()}>
                Reintentar
              </Button>
            </div>
          ) : guardadas === null ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : filas.length === 0 ? (
            <p className="text-sm text-text-2">
              Sin campos: la ficha es libre y el agente anota lo que va aprendiendo.
            </p>
          ) : (
            <ol className="space-y-3">
              {filas.map((f, i) => (
                <li key={f.uid} className="space-y-2 rounded-md border p-3" data-testid="campo-ficha">
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-[12rem] flex-1 space-y-1">
                      <Label htmlFor={`cf-label-${f.uid}`}>Nombre</Label>
                      <Input
                        id={`cf-label-${f.uid}`}
                        value={f.label}
                        maxLength={60}
                        disabled={!puedeEditar}
                        onChange={(e) => cambiar(i, { label: e.target.value })}
                        placeholder="Fecha del evento"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`cf-type-${f.uid}`}>Tipo</Label>
                      <select
                        id={`cf-type-${f.uid}`}
                        value={f.type}
                        disabled={!puedeEditar || !f.nueva}
                        title={f.nueva ? undefined : "El tipo de un campo guardado no cambia"}
                        onChange={(e) => cambiar(i, { type: e.target.value as TipoCampo })}
                        className="h-9 rounded-md border border-input bg-card px-2 text-sm"
                      >
                        {TIPOS_CAMPO.map((t) => (
                          <option key={t} value={t}>
                            {ETIQUETA_TIPO[t]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <label className="flex h-9 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={f.required === true}
                        disabled={!puedeEditar}
                        onChange={(e) => cambiar(i, { required: e.target.checked })}
                        className="accent-primary"
                      />
                      Obligatorio
                    </label>
                    {puedeEditar && (
                      <span className="flex items-center">
                        <Button variant="ghost" size="icon" aria-label="Subir" onClick={() => mover(i, -1)} disabled={i === 0}>
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label="Bajar" onClick={() => mover(i, 1)} disabled={i === filas.length - 1}>
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label={`Quitar ${f.label || "campo"}`} onClick={() => quitar(i)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </span>
                    )}
                  </div>
                  {f.type === "select" && (
                    <div className="space-y-1">
                      <Label htmlFor={`cf-opts-${f.uid}`}>Opciones (una por línea)</Label>
                      <textarea
                        id={`cf-opts-${f.uid}`}
                        value={f.opcionesTexto}
                        rows={3}
                        disabled={!puedeEditar}
                        onChange={(e) => cambiar(i, { opcionesTexto: e.target.value })}
                        className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
                      />
                    </div>
                  )}
                  <div className="space-y-1">
                    <Label htmlFor={`cf-desc-${f.uid}`}>Indicación para el agente (opcional)</Label>
                    <Input
                      id={`cf-desc-${f.uid}`}
                      value={f.description ?? ""}
                      maxLength={160}
                      disabled={!puedeEditar}
                      onChange={(e) => cambiar(i, { description: e.target.value })}
                      placeholder="Aunque sea aproximada"
                    />
                  </div>
                  {f.nueva && puedeEditar ? (
                    // M-10 — En una fila nueva la clave se puede ajustar a mano
                    // (sigue al nombre hasta que alguien la toca).
                    <div className="space-y-1">
                      <Label htmlFor={`cf-key-${f.uid}`}>Clave</Label>
                      <Input
                        id={`cf-key-${f.uid}`}
                        value={f.key}
                        maxLength={40}
                        onChange={(e) => cambiar(i, { key: e.target.value.toLowerCase() })}
                        className="font-mono text-xs"
                      />
                    </div>
                  ) : (
                    <p className="font-mono text-[11px] text-text-3">
                      clave: {f.key || "—"}
                      {!f.nueva && " · no cambia"}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}

          {aviso && <p className="text-xs text-text-2">{aviso}</p>}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}

          {puedeEditar && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={filas.length >= TOPE_CAMPOS}
                onClick={() =>
                  setFilas((xs) => [...xs, aFila({ key: "", label: "", type: "text" }, true)])
                }
              >
                <Plus className="h-4 w-4" /> Agregar campo
              </Button>
              <Button size="sm" disabled={guardando || sinCambios} onClick={() => void guardar()}>
                {guardando ? "Guardando…" : "Guardar"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {obligatorios.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Así lo ve el agente</CardTitle>
            <CardDescription>
              Mientras falten, el agente tiene presentes los siguientes (de a tres, en este orden) y los
              pide sin interrumpir: si el cliente pide una cita, no se la condiciona.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              {obligatorios.map((f) => (
                <li key={f.uid}>
                  {f.label.trim() || "Campo nuevo"} <span className="text-text-3">· {ETIQUETA_TIPO[f.type].toLowerCase()}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function mensaje(codigo: string | undefined): string {
  switch (codigo) {
    case "clave_invalida":
      return `la clave debe empezar por letra y usar minúsculas, números o _ (${CLAVE_CAMPO_RE.source}).`;
    case "clave_reservada":
      return `«${CLAVES_RESERVADAS.join(", ")}» está reservada.`;
    case "claves_repetidas":
      return "hay dos campos con la misma clave.";
    case "opciones_requeridas":
      return "una lista necesita al menos una opción.";
    case "opciones_repetidas":
      return "hay opciones repetidas.";
    case "opciones_solo_en_select":
      return "solo una lista lleva opciones.";
    default:
      return "falta el nombre o algún dato no es válido.";
  }
}
