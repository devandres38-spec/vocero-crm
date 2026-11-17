"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * 069 (US6) — País, idioma y zona de ESTE negocio (modo plataforma). Deciden
 * cómo se leen los teléfonos sin código de país, el formato de fechas y
 * números, y la zona por defecto de la agenda y de Resultados.
 */
export function RegionNegocio({
  inicial,
  editable,
}: {
  inicial: { country: string; locale: string; timezone: string };
  editable: boolean;
}) {
  const router = useRouter();
  const [country, setCountry] = useState(inicial.country);
  const [locale, setLocale] = useState(inicial.locale);
  const [timezone, setTimezone] = useState(inicial.timezone);
  const [estado, setEstado] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function guardar() {
    setOcupado(true);
    setEstado(null);
    try {
      const res = await fetch("/api/settings/region", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ country, locale, timezone }),
      });
      const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) {
        setEstado(data?.error?.message ?? "No se pudo guardar.");
        return;
      }
      setEstado("Guardado.");
      router.refresh();
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Región del negocio</CardTitle>
        <CardDescription>
          Cómo se leen los teléfonos sin código de país, el formato de fechas y números, y la zona horaria por
          defecto.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="reg-pais">País</Label>
          <Input id="reg-pais" maxLength={2} disabled={!editable} value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reg-locale">Idioma y formato</Label>
          <Input id="reg-locale" disabled={!editable} value={locale} onChange={(e) => setLocale(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reg-zona">Zona horaria</Label>
          <Input id="reg-zona" disabled={!editable} value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        </div>
        {editable && (
          <div className="flex items-center gap-3 sm:col-span-3">
            <Button onClick={guardar} disabled={ocupado}>
              Guardar región
            </Button>
            {estado && <span className="text-sm text-text-3">{estado}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
