"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EnlaceUnaVez } from "@/components/plataforma/enlace-una-vez";
import { leerErrorPlataforma } from "@/components/plataforma/errores";

/**
 * 069 (US2) — Asistente de alta: info y región (a), marca (a) e invitación del
 * `owner` (f). Arma el `OrganizationBlueprint` en el cliente y lo manda tal
 * cual: lo que ve el Super-Admin en «Ver JSON» es exactamente lo que recibe
 * la API.
 */

type Defaults = { country: string; locale: string; timezone: string; currency: string; accent: string };

const SELECT =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:border-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-soft";

function sugerirSlug(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

export function AltaNegocio({
  base,
  defaults,
  monedas,
}: {
  base: string | null;
  defaults: Defaults;
  monedas: { code: string; label: string }[];
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTocado, setSlugTocado] = useState(false);
  const [country, setCountry] = useState(defaults.country);
  const [locale, setLocale] = useState(defaults.locale);
  const [timezone, setTimezone] = useState(defaults.timezone);
  const [currency, setCurrency] = useState(defaults.currency);
  const [accent, setAccent] = useState(defaults.accent);
  const [ownerEmail, setOwnerEmail] = useState("");
  const [verJson, setVerJson] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [creado, setCreado] = useState<{ id: string; url?: string; expiresAt?: string } | null>(null);

  const slugFinal = slugTocado ? slug : sugerirSlug(name);

  const blueprint = useMemo(
    () => ({
      version: 1,
      organization: { slug: slugFinal, name: name.trim() },
      region: { country, locale, timezone },
      brand: { name: name.trim().slice(0, 30), accent, currency },
      ...(ownerEmail.trim() ? { owner: { email: ownerEmail.trim() } } : {}),
    }),
    [slugFinal, name, country, locale, timezone, accent, currency, ownerEmail]
  );

  async function enviar(dryRun: boolean) {
    setError(null);
    setPlan(null);
    setEnviando(true);
    try {
      const res = await fetch(`/api/platform/organizations${dryRun ? "?dryRun=true" : ""}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(blueprint),
      });
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) {
        setError(leerErrorPlataforma(data));
        return;
      }
      if (dryRun) {
        setPlan(JSON.stringify(data, null, 2));
        return;
      }
      const inv = data?.invitation as { status?: string; url?: string; expiresAt?: string } | undefined;
      setCreado({
        id: String(data?.organizationId ?? ""),
        url: inv?.status === "creada" ? inv.url : undefined,
        expiresAt: inv?.expiresAt,
      });
    } finally {
      setEnviando(false);
    }
  }

  if (creado) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Negocio creado</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {creado.url ? (
            <EnlaceUnaVez url={creado.url} expiresAt={creado.expiresAt} />
          ) : (
            <p className="text-text-2">Sin invitación: puedes generarla desde el detalle del negocio.</p>
          )}
          <Link href={`/platform/organizaciones/${creado.id}`} className="text-accent underline underline-offset-4">
            Ir al detalle del negocio
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>1 · El negocio</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="alta-nombre">Nombre</Label>
            <Input id="alta-nombre" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="alta-slug">Dirección (no se puede cambiar después)</Label>
            <Input
              id="alta-slug"
              value={slugFinal}
              maxLength={40}
              onChange={(e) => {
                setSlugTocado(true);
                setSlug(e.target.value.toLowerCase());
              }}
            />
            <p className="font-mono text-xs text-text-3">
              {slugFinal || "tu-negocio"}.{base ?? "<PLATFORM_BASE_DOMAIN>"}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="alta-pais">País (ISO, p. ej. CO)</Label>
            <Input id="alta-pais" value={country} maxLength={2} onChange={(e) => setCountry(e.target.value.toUpperCase())} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="alta-locale">Idioma y formato (p. ej. es-CO)</Label>
            <Input id="alta-locale" value={locale} onChange={(e) => setLocale(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="alta-zona">Zona horaria (IANA)</Label>
            <Input id="alta-zona" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2 · Marca</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="alta-acento">Color de acento</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Elegir color"
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                className="h-9 w-12 rounded border"
              />
              <Input id="alta-acento" value={accent} onChange={(e) => setAccent(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="alta-moneda">Moneda</Label>
            <select id="alta-moneda" className={SELECT} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {monedas.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3 · Dueño del negocio</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <Label htmlFor="alta-owner">Correo del owner (opcional)</Label>
          <Input
            id="alta-owner"
            type="email"
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
            placeholder="dueno@negocio.co"
          />
          <p className="text-xs text-text-3">
            Se genera un enlace de invitación de un solo uso, válido 7 días. No se envía ningún correo: lo copias tú.
          </p>
        </CardContent>
      </Card>

      {error && (
        <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint p-3 text-sm text-danger-text">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => enviar(false)} disabled={enviando || !name.trim()}>
          {enviando ? "Creando…" : "Crear negocio"}
        </Button>
        <Button variant="outline" onClick={() => enviar(true)} disabled={enviando || !name.trim()}>
          Revisar sin crear
        </Button>
        <Button variant="outline" onClick={() => setVerJson((v) => !v)}>
          {verJson ? "Ocultar JSON" : "Ver JSON"}
        </Button>
      </div>

      {verJson && (
        <pre className="overflow-x-auto rounded-md border bg-background p-3 font-mono text-xs">
          {JSON.stringify(blueprint, null, 2)}
        </pre>
      )}
      {plan && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Esto es lo que pasaría (no se creó nada):</p>
          <pre className="overflow-x-auto rounded-md border bg-background p-3 font-mono text-xs">{plan}</pre>
        </div>
      )}
    </div>
  );
}
