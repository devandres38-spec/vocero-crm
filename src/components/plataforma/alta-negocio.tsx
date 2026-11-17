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
 * 069 (US2, US8) — Asistente de alta: negocio y región (a), marca (a),
 * módulos (b), pipeline (c), agente y conocimiento (d), agenda (e) e
 * invitación del `owner` (f). Arma el `OrganizationBlueprint` en el cliente y
 * lo manda tal cual: lo que se ve en «Ver JSON» es exactamente lo que recibe
 * la API (y lo mismo que mandaría una IA por el MCP).
 */

type Defaults = { country: string; locale: string; timezone: string; currency: string; accent: string };
export type TechoUi = { agenda: boolean; atribucion: boolean; channels: string[] };

const SELECT =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:border-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-soft";
const AREA = "w-full rounded-md border border-input bg-background p-2 text-sm";

const DIAS = [
  ["mon", "Lun"],
  ["tue", "Mar"],
  ["wed", "Mié"],
  ["thu", "Jue"],
  ["fri", "Vie"],
  ["sat", "Sáb"],
  ["sun", "Dom"],
] as const;

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

/** «Pregunta | Respuesta» por línea → entrada `qa`; una línea sin `|` es un bloque. */
export function entradasDeTexto(texto: string) {
  return texto
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf("|");
      return i > 0
        ? { kind: "qa" as const, question: l.slice(0, i).trim(), answer: l.slice(i + 1).trim() }
        : { kind: "block" as const, content: l };
    });
}

export function AltaNegocio({
  base,
  defaults,
  monedas,
  techo,
}: {
  base: string | null;
  defaults: Defaults;
  monedas: { code: string; label: string }[];
  techo: TechoUi;
}) {
  // a — negocio, región y marca
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTocado, setSlugTocado] = useState(false);
  const [country, setCountry] = useState(defaults.country);
  const [locale, setLocale] = useState(defaults.locale);
  const [timezone, setTimezone] = useState(defaults.timezone);
  const [currency, setCurrency] = useState(defaults.currency);
  const [accent, setAccent] = useState(defaults.accent);
  // b — módulos (dentro del techo de la instancia)
  const [agenda, setAgenda] = useState(techo.agenda);
  const [atribucion, setAtribucion] = useState(techo.atribucion);
  const [canales, setCanales] = useState<string[]>(techo.channels);
  // c — pipeline
  const [etapas, setEtapas] = useState("");
  // d — agente y conocimiento
  const [agenteNombre, setAgenteNombre] = useState("");
  const [tono, setTono] = useState("");
  const [saludo, setSaludo] = useState("");
  const [instrucciones, setInstrucciones] = useState("");
  const [conocimiento, setConocimiento] = useState("");
  // e — agenda
  const [usarAgenda, setUsarAgenda] = useState(false);
  const [dias, setDias] = useState<string[]>(["mon", "tue", "wed", "thu", "fri"]);
  const [desde, setDesde] = useState("09:00");
  const [hasta, setHasta] = useState("18:00");
  const [duracion, setDuracion] = useState(30);
  // f — owner
  const [ownerEmail, setOwnerEmail] = useState("");
  // Avanzado
  const [verJson, setVerJson] = useState(false);
  const [jsonPropio, setJsonPropio] = useState("");

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [creado, setCreado] = useState<{ id: string; url?: string; expiresAt?: string } | null>(null);

  const slugFinal = slugTocado ? slug : sugerirSlug(name);

  const blueprint = useMemo(() => {
    const listaEtapas = etapas
      .split("\n")
      .map((e) => e.trim())
      .filter(Boolean);
    const entradas = entradasDeTexto(conocimiento);
    const agente = {
      ...(agenteNombre.trim() ? { name: agenteNombre.trim() } : {}),
      ...(tono.trim() ? { tone: tono.trim() } : {}),
      ...(saludo.trim() ? { greeting: saludo.trim() } : {}),
      ...(instrucciones.trim() ? { instructions: instrucciones.trim() } : {}),
    };
    return {
      version: 1,
      organization: { slug: slugFinal, name: name.trim() },
      region: { country, locale, timezone },
      brand: { name: name.trim().slice(0, 30), accent, currency },
      modules: {
        ...(techo.agenda ? { agenda } : {}),
        ...(techo.atribucion ? { atribucion } : {}),
        channels: ["whatsapp", ...canales.filter((c) => c !== "whatsapp")],
      },
      ...(listaEtapas.length ? { pipeline: { stages: listaEtapas } } : {}),
      ...(Object.keys(agente).length ? { agent: agente } : {}),
      ...(entradas.length ? { knowledge: { mode: "merge", entries: entradas } } : {}),
      ...(usarAgenda && techo.agenda
        ? {
            agenda: {
              weeklyHours: Object.fromEntries(dias.map((d) => [d, [{ start: desde, end: hasta }]])),
              slotMinutes: duracion,
              timezone,
            },
          }
        : {}),
      ...(ownerEmail.trim() ? { owner: { email: ownerEmail.trim() } } : {}),
    };
  }, [
    slugFinal, name, country, locale, timezone, accent, currency, techo, agenda, atribucion, canales, etapas,
    agenteNombre, tono, saludo, instrucciones, conocimiento, usarAgenda, dias, desde, hasta, duracion, ownerEmail,
  ]);

  const puedeEnviar = !enviando && (name.trim() !== "" || jsonPropio.trim() !== "");

  async function enviar(dryRun: boolean) {
    setError(null);
    setPlan(null);
    setEnviando(true);
    try {
      const res = await fetch(`/api/platform/organizations${dryRun ? "?dryRun=true" : ""}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: jsonPropio.trim() ? jsonPropio : JSON.stringify(blueprint),
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
            <Label htmlFor="alta-pais">País (código de 2 letras)</Label>
            <Input id="alta-pais" value={country} maxLength={2} onChange={(e) => setCountry(e.target.value.toUpperCase())} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="alta-locale">Idioma y formato</Label>
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
          <CardTitle>3 · Módulos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-xs text-text-3">Solo lo que esta instancia permite. WhatsApp va siempre.</p>
          {techo.agenda && <Casilla etiqueta="Agenda (citas)" valor={agenda} onChange={setAgenda} />}
          {techo.atribucion && <Casilla etiqueta="Atribución de anuncios" valor={atribucion} onChange={setAtribucion} />}
          {techo.channels
            .filter((c) => c !== "whatsapp")
            .map((c) => (
              <Casilla
                key={c}
                etiqueta={c}
                valor={canales.includes(c)}
                onChange={(v) => setCanales((cs) => (v ? [...cs, c] : cs.filter((x) => x !== c)))}
              />
            ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>4 · Pipeline</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <Label htmlFor="alta-etapas">Etapas abiertas, una por línea (vacío = las de siempre)</Label>
          <textarea id="alta-etapas" rows={4} value={etapas} onChange={(e) => setEtapas(e.target.value)} className={AREA} />
          <p className="text-xs text-text-3">Las etapas de cierre («Cliente» y «Perdido») van siempre al final.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>5 · Agente y conocimiento</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="alta-agente">Nombre del agente</Label>
            <Input id="alta-agente" maxLength={60} value={agenteNombre} onChange={(e) => setAgenteNombre(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="alta-tono">Tono</Label>
            <Input id="alta-tono" maxLength={500} value={tono} onChange={(e) => setTono(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="alta-saludo">Saludo</Label>
            <Input id="alta-saludo" maxLength={1000} value={saludo} onChange={(e) => setSaludo(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="alta-instr">Instrucciones</Label>
            <textarea
              id="alta-instr"
              rows={4}
              maxLength={8000}
              value={instrucciones}
              onChange={(e) => setInstrucciones(e.target.value)}
              className={AREA}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="alta-kb">Conocimiento: «Pregunta | Respuesta» por línea (sin «|» es un bloque de texto)</Label>
            <textarea id="alta-kb" rows={4} value={conocimiento} onChange={(e) => setConocimiento(e.target.value)} className={AREA} />
          </div>
        </CardContent>
      </Card>

      {techo.agenda && (
        <Card>
          <CardHeader>
            <CardTitle>6 · Agenda</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Casilla etiqueta="Configurar horario de atención" valor={usarAgenda} onChange={setUsarAgenda} />
            {usarAgenda && (
              <>
                <div className="flex flex-wrap gap-3">
                  {DIAS.map(([k, l]) => (
                    <Casilla
                      key={k}
                      etiqueta={l}
                      valor={dias.includes(k)}
                      onChange={(v) => setDias((ds) => (v ? [...ds, k] : ds.filter((d) => d !== k)))}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="alta-desde">Desde</Label>
                    <Input id="alta-desde" type="time" value={desde} onChange={(e) => setDesde(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="alta-hasta">Hasta</Label>
                    <Input id="alta-hasta" type="time" value={hasta} onChange={(e) => setHasta(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="alta-dur">Duración de la cita (min)</Label>
                    <Input
                      id="alta-dur"
                      type="number"
                      min={10}
                      max={240}
                      value={duracion}
                      onChange={(e) => setDuracion(Number(e.target.value))}
                    />
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>7 · Dueño del negocio</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <Label htmlFor="alta-owner">Correo del owner (opcional)</Label>
          <Input id="alta-owner" type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} />
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
        <Button onClick={() => enviar(false)} disabled={!puedeEnviar}>
          {enviando ? "Creando…" : "Crear negocio"}
        </Button>
        <Button variant="outline" onClick={() => enviar(true)} disabled={!puedeEnviar}>
          Revisar sin crear
        </Button>
        <Button variant="outline" onClick={() => setVerJson((v) => !v)}>
          {verJson ? "Ocultar JSON" : "Ver / importar JSON"}
        </Button>
      </div>

      {verJson && (
        <div className="space-y-2">
          <pre className="overflow-x-auto rounded-md border bg-background p-3 font-mono text-xs">
            {JSON.stringify(blueprint, null, 2)}
          </pre>
          <Label htmlFor="alta-json">Importar JSON (si pegas un Blueprint aquí, se envía en lugar del formulario)</Label>
          <textarea
            id="alta-json"
            rows={8}
            value={jsonPropio}
            onChange={(e) => setJsonPropio(e.target.value)}
            className={`${AREA} font-mono text-xs`}
          />
        </div>
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

function Casilla({ etiqueta, valor, onChange }: { etiqueta: string; valor: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={valor} onChange={(e) => onChange(e.target.checked)} />
      <span>{etiqueta}</span>
    </label>
  );
}
