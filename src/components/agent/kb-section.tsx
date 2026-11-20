"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Pin, PinOff, Plus, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ETIQUETA_CATEGORIA, KB_CATEGORIAS, type KbCategoria } from "@/lib/kb";
import { formatNumber } from "@/lib/region";
import { useRegion } from "@/lib/region-context";

/**
 * 074 (D8) — La base de conocimiento de producción: crear, EDITAR EN SU
 * SITIO (nunca borrar para corregir un precio), título y categoría,
 * activar/desactivar, fijar, reordenar, buscar/filtrar y ver cuánto ocupa en
 * tokens contra el presupuesto.
 */

export type KbEntry = {
  id: string;
  kind: "qa" | "block";
  question: string | null;
  answer: string | null;
  content: string | null;
  title: string | null;
  category: KbCategoria;
  enabled: boolean;
  pinned: boolean;
  sortOrder: number;
};

export type KbSize = {
  chars: number;
  tokens?: number;
  budgetTokens?: number;
  warnAt: number;
  warning: boolean;
  over?: boolean;
};

const SELECT = "h-9 rounded-md border border-input bg-card px-2 text-sm";

async function enviar(url: string, method: string, body?: unknown): Promise<boolean> {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null);
  return Boolean(res?.ok);
}

export function KbSection({
  entries,
  kbSize,
  onChanged,
}: {
  entries: KbEntry[];
  kbSize: KbSize | null;
  onChanged: () => void;
}) {
  const { locale } = useRegion();
  const [nueva, setNueva] = useState<"qa" | "block" | null>(null);
  const [buscar, setBuscar] = useState("");
  const [categoria, setCategoria] = useState<KbCategoria | "todas">("todas");
  const [error, setError] = useState<string | null>(null);

  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return entries.filter((e) => {
      if (categoria !== "todas" && e.category !== categoria) return false;
      if (!q) return true;
      return [e.title, e.question, e.answer, e.content].some((t) => (t ?? "").toLowerCase().includes(q));
    });
  }, [entries, buscar, categoria]);

  const filtrando = buscar.trim() !== "" || categoria !== "todas";

  async function guardar(url: string, method: string, body?: unknown) {
    const ok = await enviar(url, method, body);
    setError(ok ? null : "No se pudo guardar el cambio.");
    onChanged();
    return ok;
  }

  async function mover(id: string, delta: -1 | 1) {
    const ids = entries.map((e) => e.id);
    const i = ids.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= ids.length) return;
    // 074 (auditoría, BAJO): las fijadas van siempre primero; mover a través
    // de esa frontera no cambiaría nada para el agente y confunde.
    if (Boolean(entries[i]?.pinned) !== Boolean(entries[j]?.pinned)) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    await guardar("/api/kb/reorder", "POST", { ids });
  }

  const tokens = kbSize?.tokens ?? null;
  const presupuesto = kbSize?.budgetTokens ?? null;
  const pct = tokens !== null && presupuesto ? Math.min(100, Math.round((tokens / presupuesto) * 100)) : null;

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>Base de conocimiento</CardTitle>
            <CardDescription>
              La única fuente de verdad del agente: lo que no está aquí (o está apagado), no lo afirma.
            </CardDescription>
          </div>
          {tokens !== null && presupuesto !== null && (
            <Badge variant={kbSize?.over ? "destructive" : kbSize?.warning ? "warning" : "secondary"}>
              ≈ {formatNumber(tokens, locale)} / {formatNumber(presupuesto, locale)} tokens
            </Badge>
          )}
        </div>
        {pct !== null && (
          <div className="mt-2">
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-secondary"
              role="meter"
              aria-label="Presupuesto de tokens de la base de conocimiento"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
            >
              <div
                className={kbSize?.over ? "h-full bg-destructive" : kbSize?.warning ? "h-full bg-warning-text" : "h-full bg-primary"}
                style={{ width: `${pct}%` }}
              />
            </div>
            {(kbSize?.warning || kbSize?.over) && (
              <p className="mt-1 text-xs text-warning-text">
                {kbSize?.over
                  ? "Te pasaste del presupuesto: el agente lee todo esto en cada mensaje (más costo y respuestas menos precisas). Apaga o resume entradas."
                  : "Te acercas al presupuesto. Apaga lo que no esté vigente o resume entradas largas."}
              </p>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Buscar en el conocimiento"
              aria-label="Buscar en el conocimiento"
              value={buscar}
              onChange={(e) => setBuscar(e.target.value)}
            />
          </label>
          <select
            className={SELECT}
            aria-label="Filtrar por categoría"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value as KbCategoria | "todas")}
          >
            <option value="todas">Todas las categorías</option>
            {KB_CATEGORIAS.map((c) => (
              <option key={c} value={c}>
                {ETIQUETA_CATEGORIA[c]}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" onClick={() => setNueva("qa")}>
            <Plus className="h-4 w-4" /> Pregunta
          </Button>
          <Button size="sm" variant="outline" onClick={() => setNueva("block")}>
            <Plus className="h-4 w-4" /> Bloque
          </Button>
        </div>

        {error && (
          <p role="alert" className="text-xs text-danger-text">
            {error}
          </p>
        )}

        {nueva && (
          <EditorEntrada
            kind={nueva}
            onCancel={() => setNueva(null)}
            onSave={async (datos) => {
              const ok = await guardar("/api/kb", "POST", { kind: nueva, ...datos });
              if (ok) setNueva(null);
            }}
          />
        )}

        <ul className="space-y-2">
          {visibles.map((e) => (
            <FilaEntrada
              key={e.id}
              entry={e}
              puedeMover={!filtrando}
              {...limitesDeMovimiento(entries, e.id)}
              onPatch={(patch) => guardar(`/api/kb/${e.id}`, "PATCH", patch)}
              onDelete={async () => {
                if (window.confirm("¿Eliminar esta entrada? Si solo ya no aplica, puedes apagarla.")) {
                  await guardar(`/api/kb/${e.id}`, "DELETE");
                }
              }}
              onMove={(d) => void mover(e.id, d)}
            />
          ))}
          {entries.length === 0 && (
            <p className="py-2 text-center text-xs text-muted-foreground">
              Sin entradas todavía: agrega lo que el agente debe saber (servicios, precios, horarios, pagos, políticas).
            </p>
          )}
          {entries.length > 0 && visibles.length === 0 && (
            <p className="py-2 text-center text-xs text-muted-foreground">Nada coincide con la búsqueda.</p>
          )}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * 074 (auditoría, BAJO) — Las flechas no cruzan la frontera entre fijadas y
 * no fijadas: «Bajar» se apaga en la última fijada y «Subir» en la primera
 * no fijada (y en los extremos de la lista).
 */
export function limitesDeMovimiento(
  entries: Pick<KbEntry, "id" | "pinned">[],
  id: string
): { primera: boolean; ultima: boolean } {
  const i = entries.findIndex((e) => e.id === id);
  if (i < 0) return { primera: true, ultima: true };
  const actual = Boolean(entries[i]!.pinned);
  const antes = entries[i - 1];
  const despues = entries[i + 1];
  return {
    primera: !antes || Boolean(antes.pinned) !== actual,
    ultima: !despues || Boolean(despues.pinned) !== actual,
  };
}

type Datos = {
  question?: string;
  answer?: string;
  content?: string;
  title: string | null;
  category: KbCategoria;
};

function EditorEntrada({
  kind,
  inicial,
  onSave,
  onCancel,
}: {
  kind: "qa" | "block";
  inicial?: KbEntry;
  onSave: (d: Datos) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(inicial?.title ?? "");
  const [category, setCategory] = useState<KbCategoria>(inicial?.category ?? "general");
  const [question, setQuestion] = useState(inicial?.question ?? "");
  const [answer, setAnswer] = useState(inicial?.answer ?? "");
  const [content, setContent] = useState(inicial?.content ?? "");
  const [guardando, setGuardando] = useState(false);
  const valido = kind === "qa" ? question.trim() && answer.trim() : content.trim();

  async function guardar() {
    if (!valido) return;
    setGuardando(true);
    await onSave({
      ...(kind === "qa" ? { question: question.trim(), answer: answer.trim() } : { content: content.trim() }),
      title: title.trim() || null,
      category,
    });
    setGuardando(false);
  }

  return (
    <div className="space-y-2 rounded-md border bg-card p-3">
      <div className="flex flex-wrap gap-2">
        <Input
          className="min-w-[12rem] flex-1"
          placeholder="Título (opcional)"
          aria-label="Título"
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <select
          className={SELECT}
          aria-label="Categoría"
          value={category}
          onChange={(e) => setCategory(e.target.value as KbCategoria)}
        >
          {KB_CATEGORIAS.map((c) => (
            <option key={c} value={c}>
              {ETIQUETA_CATEGORIA[c]}
            </option>
          ))}
        </select>
      </div>
      {kind === "qa" ? (
        <>
          <Input
            placeholder="Pregunta (p. ej. ¿Hacen envíos?)"
            aria-label="Pregunta"
            maxLength={500}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <Textarea
            placeholder="Respuesta"
            aria-label="Respuesta"
            rows={3}
            maxLength={4000}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
        </>
      ) : (
        <Textarea
          placeholder="Horarios, direcciones, políticas…"
          aria-label="Contenido del bloque"
          rows={4}
          maxLength={8000}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void guardar()} disabled={!valido || guardando}>
          {inicial ? "Guardar cambios" : "Agregar"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

function FilaEntrada({
  entry: e,
  puedeMover,
  primera,
  ultima,
  onPatch,
  onDelete,
  onMove,
}: {
  entry: KbEntry;
  puedeMover: boolean;
  primera: boolean;
  ultima: boolean;
  onPatch: (patch: Record<string, unknown>) => Promise<boolean>;
  onDelete: () => Promise<void>;
  onMove: (d: -1 | 1) => void;
}) {
  const [editando, setEditando] = useState(false);

  if (editando) {
    return (
      <li>
        <EditorEntrada
          kind={e.kind}
          inicial={e}
          onCancel={() => setEditando(false)}
          onSave={async (datos) => {
            if (await onPatch(datos)) setEditando(false);
          }}
        />
      </li>
    );
  }

  return (
    <li className={`flex items-start gap-2 rounded-md border p-3 ${e.enabled ? "" : "opacity-60"}`}>
      <div className="min-w-0 flex-1 text-sm">
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">{ETIQUETA_CATEGORIA[e.category] ?? e.category}</Badge>
          {e.pinned && <Badge variant="default">Fijada</Badge>}
          {!e.enabled && <Badge variant="outline">Apagada</Badge>}
          {e.title && <span className="font-semibold">{e.title}</span>}
        </div>
        {e.kind === "qa" ? (
          <>
            <p className="font-medium">{e.question}</p>
            <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{e.answer}</p>
          </>
        ) : (
          <p className="whitespace-pre-wrap text-muted-foreground">{e.content}</p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Switch
          checked={e.enabled}
          label={e.enabled ? "Entrada activa" : "Entrada apagada"}
          onCheckedChange={(enabled) => void onPatch({ enabled })}
        />
        <div className="flex">
          <Button
            variant="ghost"
            size="icon"
            aria-label={e.pinned ? "Quitar de fijadas" : "Fijar arriba"}
            onClick={() => void onPatch({ pinned: !e.pinned })}
          >
            {e.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" aria-label="Editar entrada" onClick={() => setEditando(true)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Eliminar entrada" onClick={() => void onDelete()}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
        {puedeMover && (
          <div className="flex">
            <Button variant="ghost" size="icon" aria-label="Subir" disabled={primera} onClick={() => onMove(-1)}>
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Bajar" disabled={ultima} onClick={() => onMove(1)}>
              <ArrowDown className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}
