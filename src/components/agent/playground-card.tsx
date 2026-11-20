"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/**
 * 074 (D9, decisión #9) — «Probar mi agente»: un chat con el MISMO agente
 * que contesta a los clientes, con la llave del negocio, sin escribirle a
 * nadie ni dejar nada en la Bandeja. El historial vive aquí (se reinicia con
 * el botón o al salir de la página) y viaja con cada mensaje.
 */

type Linea =
  | { role: "customer"; text: string }
  | { role: "agent"; text: string }
  | { role: "accion"; text: string };

type Estado = { available: boolean; platform: boolean; used: number; limit: number; remaining: number };

const MAX_HISTORIAL = 40;

/** Cómo se lee una acción simulada del turno. */
function describirAccion(a: { type: string; [k: string]: unknown }): string {
  switch (a.type) {
    case "handoff":
      return `Pasaría la conversación a una persona${typeof a.reason === "string" ? ` (${a.reason})` : ""}`;
    case "ficha":
      return `Guardaría en la ficha: ${Object.keys((a.fields as Record<string, unknown>) ?? {}).join(", ") || "datos"}`;
    case "stage":
      return `Movería al lead a «${String(a.stage ?? "")}»`;
    case "availability":
      return "Consultó horarios disponibles";
    case "booking_simulated":
      return "Agendaría una cita (simulada)";
    case "booking_rescheduled_simulated":
      return "Movería la cita (simulado)";
    case "booking_cancelled_simulated":
      return "Cancelaría la cita (simulado)";
    default:
      return `Acción: ${a.type}`;
  }
}

export function PlaygroundCard() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fin = useRef<HTMLDivElement | null>(null);

  const cargar = useCallback(async () => {
    const d = (await fetch("/api/agent/playground")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)) as Estado | null;
    setEstado(d);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    fin.current?.scrollIntoView?.({ block: "nearest" });
  }, [lineas]);

  if (!estado) return null;

  async function enviar() {
    const mensaje = texto.trim();
    if (!mensaje || enviando) return;
    const history = lineas
      .filter((l): l is Extract<Linea, { role: "customer" | "agent" }> => l.role !== "accion")
      .slice(-MAX_HISTORIAL)
      .map((l) => ({ role: l.role, text: l.text.slice(0, 2000) }));
    setEnviando(true);
    setError(null);
    setTexto("");
    setLineas((ls) => [...ls, { role: "customer", text: mensaje }]);
    const res = await fetch("/api/agent/playground", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: mensaje, history }),
    }).catch(() => null);
    const d = (await res?.json().catch(() => null)) as {
      turn?: { replies: string[]; actions: { type: string; [k: string]: unknown }[] } | null;
      notice?: string | null;
      used?: number;
      limit?: number;
      remaining?: number;
      error?: { code?: string; message?: string };
    } | null;
    setEnviando(false);
    if (d && typeof d.remaining === "number" && typeof d.limit === "number") {
      setEstado((e) => (e ? { ...e, used: d.used ?? e.used, limit: d.limit!, remaining: d.remaining! } : e));
    }
    if (!res?.ok || !d) {
      setError(d?.error?.message ?? "No se pudo correr la prueba.");
      return;
    }
    const nuevas: Linea[] = [
      ...(d.turn?.actions ?? []).map((a) => ({ role: "accion" as const, text: describirAccion(a) })),
      ...(d.turn?.replies ?? []).map((r) => ({ role: "agent" as const, text: r })),
    ];
    if (nuevas.length === 0) nuevas.push({ role: "accion", text: "El agente no contestó nada en este turno." });
    setLineas((ls) => [...ls, ...nuevas]);
    if (d.notice) setError(d.notice);
  }

  const sinCupo = estado.remaining <= 0;

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>Probar mi agente</CardTitle>
            <CardDescription>
              Escríbele como si fueras un cliente. Usa tu configuración y tu llave de IA, pero no le escribe a nadie,
              no crea conversaciones y las citas son simuladas.
            </CardDescription>
          </div>
          {estado.platform && (
            <Badge variant={sinCupo ? "warning" : "secondary"}>
              {estado.remaining} de {estado.limit} pruebas hoy
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!estado.available ? (
          <p className="text-sm text-muted-foreground">
            {estado.platform
              ? "Disponible cuando tu negocio tenga un agente conectado."
              : "En esta instalación tu agente se prueba en el Laboratorio."}
          </p>
        ) : (
          <>
            <div
              className="max-h-80 min-h-[8rem] space-y-2 overflow-y-auto rounded-md border bg-secondary/40 p-3"
              aria-live="polite"
            >
              {lineas.length === 0 && (
                <p className="text-center text-xs text-muted-foreground">
                  Prueba una pregunta real: «¿Cuánto cuesta…?», «¿Dónde quedan?», «Quiero agendar».
                </p>
              )}
              {lineas.map((l, i) =>
                l.role === "accion" ? (
                  <p key={i} className="text-center text-xs italic text-muted-foreground">
                    {l.text}
                  </p>
                ) : (
                  <div key={i} className={l.role === "customer" ? "flex justify-end" : "flex justify-start"}>
                    <p
                      className={
                        l.role === "customer"
                          ? "max-w-[80%] whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
                          : "max-w-[80%] whitespace-pre-wrap rounded-lg border bg-card px-3 py-2 text-sm"
                      }
                    >
                      {l.text}
                    </p>
                  </div>
                )
              )}
              {enviando && <p className="text-xs text-muted-foreground">El agente está escribiendo…</p>}
              <div ref={fin} />
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void enviar();
              }}
            >
              <Input
                placeholder={sinCupo ? "Llegaste al tope de hoy" : "Escribe como cliente…"}
                aria-label="Mensaje de prueba"
                maxLength={2000}
                value={texto}
                disabled={enviando || sinCupo}
                onChange={(e) => setTexto(e.target.value)}
              />
              <Button type="submit" size="icon" aria-label="Enviar" disabled={enviando || sinCupo || !texto.trim()}>
                <Send className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Reiniciar conversación"
                disabled={enviando || lineas.length === 0}
                onClick={() => {
                  setLineas([]);
                  setError(null);
                }}
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            </form>
          </>
        )}
        {error && (
          <p role="alert" className="text-xs text-danger-text">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
