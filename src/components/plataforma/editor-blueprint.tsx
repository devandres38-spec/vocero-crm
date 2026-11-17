"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { leerErrorPlataforma } from "@/components/plataforma/errores";

/**
 * 069 (US8) — El Blueprint de un negocio en JSON: cargar el vigente, editar,
 * revisar (dry run) y aplicar. Es el mismo `PUT` que usaría una IA.
 */
export function EditorBlueprint({ id }: { id: string }) {
  const router = useRouter();
  const [texto, setTexto] = useState("");
  const [salida, setSalida] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function llamar(init: RequestInit, dryRun = false) {
    setError(null);
    setSalida(null);
    setOcupado(true);
    try {
      const res = await fetch(`/api/platform/organizations/${id}/blueprint${dryRun ? "?dryRun=true" : ""}`, init);
      const data = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) {
        setError(leerErrorPlataforma(data));
        return null;
      }
      return data;
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Blueprint (JSON)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-xs text-text-3">
          Declarativo: las secciones que no incluyas no se tocan. Aplicar dos veces lo mismo no cambia nada.
        </p>
        <textarea
          aria-label="Blueprint en JSON"
          rows={12}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          className="w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
          placeholder='{"version": 1, "agent": {"greeting": "¡Hola!"}}'
        />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={ocupado}
            onClick={async () => {
              const data = await llamar({ method: "GET" });
              if (data) setTexto(JSON.stringify(data, null, 2));
            }}
          >
            Cargar el vigente
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={ocupado || !texto.trim()}
            onClick={async () => {
              const data = await llamar(
                { method: "PUT", headers: { "content-type": "application/json" }, body: texto },
                true
              );
              if (data) setSalida(`Plan (no se aplicó nada):\n${JSON.stringify(data, null, 2)}`);
            }}
          >
            Revisar sin aplicar
          </Button>
          <Button
            size="sm"
            disabled={ocupado || !texto.trim()}
            onClick={async () => {
              const data = await llamar({ method: "PUT", headers: { "content-type": "application/json" }, body: texto });
              if (data) {
                setSalida(`Aplicado:\n${JSON.stringify(data, null, 2)}`);
                router.refresh();
              }
            }}
          >
            Aplicar
          </Button>
        </div>
        {error && (
          <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint p-3 text-danger-text">
            {error}
          </p>
        )}
        {salida && <pre className="overflow-x-auto rounded-md border bg-background p-3 font-mono text-xs">{salida}</pre>}
      </CardContent>
    </Card>
  );
}
