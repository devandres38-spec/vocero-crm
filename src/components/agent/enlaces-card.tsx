"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MAX_RECURSOS, urlDeRecursoValida, type Recurso } from "@/lib/kb";

/**
 * 074 (D8) — Enlaces oficiales verificados del negocio (Maps, catálogo, web,
 * link de pago): los ÚNICOS que el agente puede compartir. Solo `https://`.
 */
export function EnlacesCard({ onChanged }: { onChanged?: () => void }) {
  const [enlaces, setEnlaces] = useState<Recurso[]>([]);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/agent/resources")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { resources?: Recurso[] } | null) => setEnlaces(d?.resources ?? []))
      .catch(() => {});
  }, []);

  async function guardar(lista: Recurso[]) {
    const res = await fetch("/api/agent/resources", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resources: lista }),
    }).catch(() => null);
    if (!res?.ok) {
      setError("No se pudo guardar. Revisa que cada enlace empiece por https://");
      return false;
    }
    const d = (await res.json()) as { resources: Recurso[] };
    setEnlaces(d.resources);
    setError(null);
    onChanged?.();
    return true;
  }

  const urlLimpia = url.trim();
  const valido = label.trim().length > 0 && urlDeRecursoValida(urlLimpia);

  async function agregar() {
    if (!valido) {
      setError("Ponle un nombre y un enlace que empiece por https://");
      return;
    }
    if (await guardar([...enlaces, { label: label.trim(), url: urlLimpia }])) {
      setLabel("");
      setUrl("");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Enlaces verificados</CardTitle>
        <CardDescription>
          Ubicación en Maps, catálogo, web, link de pago. Son los únicos enlaces que tu agente comparte: nunca inventa
          uno.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-2">
          {enlaces.map((e, i) => (
            <li key={`${e.url}-${i}`} className="flex items-center gap-2 rounded-md border p-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{e.label}</p>
                <p className="truncate text-xs text-muted-foreground">{e.url}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Quitar ${e.label}`}
                onClick={() => void guardar(enlaces.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
          {enlaces.length === 0 && (
            <p className="py-1 text-center text-xs text-muted-foreground">Sin enlaces todavía.</p>
          )}
        </ul>
        {enlaces.length < MAX_RECURSOS && (
          <div className="space-y-2 rounded-md border p-3">
            <Input
              placeholder="Nombre (p. ej. Ubicación en Maps)"
              aria-label="Nombre del enlace"
              maxLength={60}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <Input
              placeholder="https://…"
              aria-label="Enlace"
              inputMode="url"
              maxLength={500}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <Button size="sm" onClick={() => void agregar()} disabled={!label.trim() || !urlLimpia}>
              <Plus className="h-4 w-4" /> Agregar enlace
            </Button>
          </div>
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
