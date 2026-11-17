"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { leerErrorPlataforma } from "@/components/plataforma/errores";
import type { TechoUi } from "@/components/plataforma/alta-negocio";

/**
 * 069 (US7, D11) — Los módulos de un negocio, dentro del techo de la
 * instancia. Solo la agencia los cambia; se guardan con un Blueprint de una
 * sola sección (`modules`), el mismo camino que la API y el MCP.
 */
export function ModulosOrganizacion({
  id,
  techo,
  efectivos,
}: {
  id: string;
  techo: TechoUi;
  efectivos: { agenda: boolean; atribucion: boolean; channels: string[] };
}) {
  const router = useRouter();
  const [agenda, setAgenda] = useState(efectivos.agenda);
  const [atribucion, setAtribucion] = useState(efectivos.atribucion);
  const [canales, setCanales] = useState(efectivos.channels);
  const [estado, setEstado] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function guardar() {
    setOcupado(true);
    setEstado(null);
    try {
      const res = await fetch(`/api/platform/organizations/${id}/blueprint`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: 1,
          modules: {
            ...(techo.agenda ? { agenda } : {}),
            ...(techo.atribucion ? { atribucion } : {}),
            channels: ["whatsapp", ...canales.filter((c) => c !== "whatsapp")],
          },
        }),
      });
      const data = (await res.json().catch(() => null)) as { sections?: { modules?: string } } | null;
      if (!res.ok) {
        setEstado(leerErrorPlataforma(data));
        return;
      }
      setEstado(data?.sections?.modules === "sin_cambios" ? "Sin cambios." : "Guardado.");
      router.refresh();
    } finally {
      setOcupado(false);
    }
  }

  const fila = (etiqueta: string, permitido: boolean, valor: boolean, onChange: (v: boolean) => void) => (
    <label key={etiqueta} className={`flex items-center gap-2 ${permitido ? "" : "opacity-60"}`}>
      <input type="checkbox" disabled={!permitido} checked={permitido && valor} onChange={(e) => onChange(e.target.checked)} />
      <span>{etiqueta}</span>
      {!permitido && <span className="text-xs text-text-3">· no disponible en esta instancia</span>}
    </label>
  );

  const opcionales = ["instagram", "messenger", "tiktok"];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Módulos</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {fila("Agenda (citas)", techo.agenda, agenda, setAgenda)}
        {fila("Atribución de anuncios", techo.atribucion, atribucion, setAtribucion)}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked disabled />
          <span>WhatsApp</span>
          <span className="text-xs text-text-3">· siempre</span>
        </label>
        {opcionales.map((c) =>
          fila(c, techo.channels.includes(c), canales.includes(c), (v) =>
            setCanales((cs) => (v ? [...cs, c] : cs.filter((x) => x !== c)))
          )
        )}
        <div className="flex items-center gap-3 pt-2">
          <Button size="sm" onClick={guardar} disabled={ocupado}>
            Guardar módulos
          </Button>
          {estado && <span className="text-xs text-text-3">{estado}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
