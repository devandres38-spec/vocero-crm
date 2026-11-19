"use client";

import { useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fichaEntries, fichaLabel, fichaValueText, parseFichaValue } from "@/lib/ficha";
import { aBooleano, coaccionar, valorPropio, type FichaField } from "@/lib/ficha-campos";
import { useVocabulario } from "@/lib/vocabulario-context";
import type { FichaDto, FichaValue } from "@/lib/types";

/**
 * Lo que se sabe del lead, donde se trabaja la conversación.
 *
 * Existe porque `PUT /api/bot/ficha` ya deja al agente guardar lo que
 * averigua: sin esta pantalla, eso era un cajón que se llenaba y no se abría.
 *
 * Se puede corregir a mano. Un dato equivocado que el dueño ve pero no puede
 * arreglar es peor que no tenerlo: enseña a desconfiar de toda la ficha.
 *
 * 072 (FR-014) — Si el negocio definió sus campos (Ajustes → Ficha), salen
 * arriba, en su orden y con su control (fecha, lista, sí/no, número). Debajo,
 * «Otros datos»: lo que el agente o alguien guardó fuera del esquema, con el
 * editor libre de siempre. Sin campos, el panel es el de 2.11.0.
 */
export function FichaPanel({
  ficha,
  campos = [],
  onSave,
}: {
  ficha: FichaDto;
  /** 072 — Los campos del negocio; vacío = ficha libre. */
  campos?: FichaField[];
  /** Parche: solo lo que cambia. `null` borra la clave. */
  onSave: (patch: Record<string, FichaValue | null>) => Promise<void>;
}) {
  const v = useVocabulario();
  const [editando, setEditando] = useState<string | null>(null);
  const [borrador, setBorrador] = useState("");
  const [agregando, setAgregando] = useState(false);
  const [claveNueva, setClaveNueva] = useState("");
  const [valorNuevo, setValorNuevo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);

  const delEsquema = new Set(campos.map((c) => c.key));
  const entradas = fichaEntries(ficha).filter(([clave]) => !delEsquema.has(clave));
  const conEsquema = campos.length > 0;

  /**
   * M-10 (auditoría 072-A) — `true` solo si se guardó. Si falla, el error se
   * muestra y quien llamó deja la edición abierta con lo escrito.
   */
  async function guardar(patch: Record<string, FichaValue | null>): Promise<boolean> {
    setGuardando(true);
    setErrorGuardar(null);
    try {
      await onSave(patch);
      return true;
    } catch (err) {
      setErrorGuardar(err instanceof Error && err.message ? err.message : "No se pudo guardar. Intenta de nuevo.");
      return false;
    } finally {
      setGuardando(false);
    }
  }

  /** A-7 (auditoría 072-A) — La edición libre se abre siempre con SU valor (nunca vacía ni con el borrador de otra clave). */
  function abrirEdicionLibre(clave: string, valor: FichaValue | undefined) {
    setErrorGuardar(null);
    setBorrador(valor === undefined ? "" : fichaValueText(valor));
    setEditando(clave);
  }

  async function confirmarEdicion(clave: string) {
    const actual = valorPropio(ficha, clave) as FichaValue | undefined;
    const valor = parseFichaValue(borrador, actual);
    // Vacío no borra: para eso está el bote de basura. Un campo que se vacía
    // solo, porque alguien seleccionó y salió, se lleva un dato que costó una
    // conversación.
    if (valor === "" || valor === actual) {
      setEditando(null);
      return;
    }
    if (await guardar({ [clave]: valor })) setEditando(null);
  }

  async function agregar() {
    const clave = claveNueva.trim();
    const valor = valorNuevo.trim();
    if (!clave || !valor) return;
    if (!(await guardar({ [clave]: valor }))) return;
    setAgregando(false);
    setClaveNueva("");
    setValorNuevo("");
  }

  return (
    <section className="border-b p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="kicker">
          {v("ficha")}
        </p>
        {!agregando && (
          <button
            onClick={() => setAgregando(true)}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-text-3 hover:bg-accent hover:text-foreground"
          >
            <Plus className="h-3 w-3" />
            Agregar
          </button>
        )}
      </div>

      {conEsquema && (
        <dl className="mb-3 space-y-1.5">
          {campos.map((campo) => (
            <CampoTipado
              key={campo.key}
              campo={campo}
              valor={valorPropio(ficha, campo.key) as FichaValue | undefined}
              guardando={guardando}
              onGuardar={(valor) => guardar({ [campo.key]: valor })}
            />
          ))}
        </dl>
      )}

      {errorGuardar && (
        <p role="alert" className="mb-2 text-[11px] text-danger">
          {errorGuardar}
        </p>
      )}

      {conEsquema && entradas.length > 0 && (
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-text-3">Otros datos</p>
      )}

      {!conEsquema && entradas.length === 0 && !agregando && (
        <p className="text-xs leading-relaxed text-text-3">
          Todavía vacía. Aquí aparece lo que tu agente va averiguando del lead
          mientras conversa — y puedes escribirlo tú.
        </p>
      )}

      {entradas.length > 0 && (
        <dl className="space-y-1.5">
          {entradas.map(([clave, valor]) => (
            <div key={clave} className="group flex items-start gap-2 text-xs">
              <dt className="w-[38%] shrink-0 pt-1 text-text-3">
                {fichaLabel(clave)}
              </dt>
              <dd className="flex min-w-0 flex-1 items-start gap-1">
                {editando === clave ? (
                  <>
                    <Input
                      autoFocus
                      value={borrador}
                      onChange={(e) => setBorrador(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void confirmarEdicion(clave);
                        if (e.key === "Escape") setEditando(null);
                      }}
                      className="h-7 py-0 text-xs"
                      aria-label={`Valor de ${fichaLabel(clave)}`}
                    />
                    <button
                      disabled={guardando}
                      onClick={() => void confirmarEdicion(clave)}
                      aria-label="Guardar"
                      className="rounded p-1 text-text-3 hover:bg-accent hover:text-foreground"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setEditando(null)}
                      aria-label="Cancelar"
                      className="rounded p-1 text-text-3 hover:bg-accent hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => abrirEdicionLibre(clave, valor)}
                      className="min-w-0 flex-1 break-words rounded px-1 py-1 text-left hover:bg-accent"
                      aria-label={`Editar ${fichaLabel(clave)}`}
                    >
                      {fichaValueText(valor)}
                    </button>
                    <span className="flex opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <button
                        onClick={() => abrirEdicionLibre(clave, valor)}
                        aria-label={`Editar ${fichaLabel(clave)}`}
                        className="rounded p-1 text-text-3 hover:bg-accent hover:text-foreground"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        disabled={guardando}
                        onClick={() => void guardar({ [clave]: null })}
                        aria-label={`Quitar ${fichaLabel(clave)}`}
                        className="rounded p-1 text-text-3 hover:bg-accent hover:text-danger"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </span>
                  </>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {agregando && (
        <div className="mt-2 space-y-1.5">
          <Input
            autoFocus
            value={claveNueva}
            onChange={(e) => setClaveNueva(e.target.value)}
            placeholder="Qué dato (ej. presupuesto)"
            className="h-7 py-0 text-xs"
            aria-label="Nombre del dato"
          />
          <Input
            value={valorNuevo}
            onChange={(e) => setValorNuevo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void agregar();
              if (e.key === "Escape") setAgregando(false);
            }}
            placeholder="Valor"
            className="h-7 py-0 text-xs"
            aria-label="Valor del dato"
          />
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              disabled={!claveNueva.trim() || !valorNuevo.trim() || guardando}
              onClick={() => void agregar()}
            >
              Agregar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAgregando(false);
                setClaveNueva("");
                setValorNuevo("");
              }}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Cómo se lee un valor tipado (la fecha en día/mes/año, como se escribe aquí). */
export function textoDeCampo(campo: FichaField, valor: FichaValue | undefined): string {
  if (valor === undefined || valor === null || valor === "") return "";
  if (campo.type === "date" && typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    const [a, m, d] = valor.split("-");
    return `${d}/${m}/${a}`;
  }
  return fichaValueText(valor);
}

const CONTROL = "h-7 w-full rounded-md border border-input bg-card px-2 py-0 text-xs";

/** Un campo del esquema: se edita con el control de su tipo y se guarda al confirmar. */
function CampoTipado({
  campo,
  valor,
  guardando,
  onGuardar,
}: {
  campo: FichaField;
  valor: FichaValue | undefined;
  guardando: boolean;
  /** `true` si se guardó (M-10: si no, la edición queda abierta). */
  onGuardar: (valor: FichaValue | null) => Promise<boolean>;
}) {
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState("");
  const [error, setError] = useState(false);
  const vacio = valor === undefined || valor === null || valor === "";
  const etiqueta = `${campo.label}${campo.required ? " *" : ""}`;

  function abrir() {
    setError(false);
    setBorrador(
      // M-10 — `aBooleano`: un `"no"` o un `0` guardados no se abren como «Sí».
      vacio ? "" : campo.type === "boolean" ? (aBooleano(valor) ? "si" : "no") : String(valor)
    );
    setEditando(true);
  }

  async function confirmar() {
    if (borrador.trim() === "") {
      // Vacío no borra (igual que la ficha libre): para eso está el bote.
      setEditando(false);
      return;
    }
    const r = coaccionar(campo, borrador);
    if (!r.ok) {
      setError(true);
      return;
    }
    if (r.valor === valor) {
      setEditando(false);
      return;
    }
    if (await onGuardar(r.valor)) setEditando(false);
  }

  const teclas = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") void confirmar();
    if (e.key === "Escape") setEditando(false);
  };

  return (
    <div className="group flex items-start gap-2 text-xs">
      <dt className="w-[38%] shrink-0 pt-1 text-text-3" title={campo.description}>
        {etiqueta}
      </dt>
      <dd className="flex min-w-0 flex-1 items-start gap-1">
        {editando ? (
          <>
            {campo.type === "select" || campo.type === "boolean" ? (
              <select
                autoFocus
                value={borrador}
                onChange={(e) => setBorrador(e.target.value)}
                onKeyDown={teclas}
                className={CONTROL}
                aria-label={`Valor de ${campo.label}`}
              >
                <option value="">—</option>
                {(campo.type === "boolean" ? ["Sí", "No"] : campo.options ?? []).map((o) => (
                  <option key={o} value={campo.type === "boolean" ? (o === "Sí" ? "si" : "no") : o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                autoFocus
                type={campo.type === "date" ? "date" : "text"}
                inputMode={campo.type === "number" ? "decimal" : undefined}
                value={borrador}
                onChange={(e) => {
                  setBorrador(e.target.value);
                  setError(false);
                }}
                onKeyDown={teclas}
                className={`h-7 py-0 text-xs ${error ? "border-danger" : ""}`}
                aria-invalid={error}
                title={error ? "Ese valor no encaja con el tipo del campo" : undefined}
                aria-label={`Valor de ${campo.label}`}
              />
            )}
            <button
              disabled={guardando}
              onClick={() => void confirmar()}
              aria-label="Guardar"
              className="rounded p-1 text-text-3 hover:bg-accent hover:text-foreground"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setEditando(false)}
              aria-label="Cancelar"
              className="rounded p-1 text-text-3 hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <>
            <button
              onClick={abrir}
              className={`min-w-0 flex-1 break-words rounded px-1 py-1 text-left hover:bg-accent ${vacio ? "text-text-4" : ""}`}
              aria-label={`Editar ${campo.label}`}
            >
              {vacio ? "Sin dato" : textoDeCampo(campo, valor)}
            </button>
            {!vacio && (
              <span className="flex opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <button
                  disabled={guardando}
                  onClick={() => void onGuardar(null)}
                  aria-label={`Quitar ${campo.label}`}
                  className="rounded p-1 text-text-3 hover:bg-accent hover:text-danger"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            )}
          </>
        )}
      </dd>
    </div>
  );
}
