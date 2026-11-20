"use client";

import { useRegion } from "@/lib/region-context";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, KeyRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { leerErrorPlataforma } from "@/components/plataforma/errores";
import { Campo, FilaInterruptor, Seccion } from "@/components/plataforma/formulario/controles";
import { COPIA_MANUAL, copiarAlPortapapeles } from "@/lib/clipboard";

type Token = {
  id: string;
  name: string;
  last4: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

const fecha = (iso: string | null, locale: string) =>
  iso ? new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) : "—";

export type EstadoToken = "vigente" | "vencido" | "revocado";

/** Pura: el estado de un token para su insignia. */
export function estadoToken(t: Pick<Token, "expiresAt" | "revokedAt">, ahora: number = Date.now()): EstadoToken {
  if (t.revokedAt) return "revocado";
  if (t.expiresAt && Date.parse(t.expiresAt) <= ahora) return "vencido";
  return "vigente";
}

export const INSIGNIA_ESTADO: Record<EstadoToken, { texto: string; variante: "success" | "secondary" | "destructive" }> = {
  vigente: { texto: "Vigente", variante: "success" },
  vencido: { texto: "Vencido", variante: "secondary" },
  revocado: { texto: "Revocado", variante: "destructive" },
};

/**
 * 069 (D14) — Crear y revocar tokens personales. El token se ve UNA vez.
 * Auditoría final (F-01, F-08): mismo diseño que el resto del panel y copia
 * que funciona también por HTTP (y solo dice «Copiado» si copió).
 */
export function GestorTokens({ inicial }: { inicial: Token[] }) {
  // 073-C (D7): fechas en el idioma de la región del negocio, no del navegador.
  const { locale } = useRegion();
  const router = useRouter();
  const [name, setName] = useState("");
  const [provision, setProvision] = useState(false);
  const [dias, setDias] = useState("90");
  const [nuevo, setNuevo] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOcupado(true);
    try {
      const res = await fetch("/api/platform/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          scopes: provision ? ["read", "provision"] : ["read"],
          ...(dias ? { expiresInDays: Number(dias) } : {}),
        }),
      });
      const data = (await res.json().catch(() => null)) as { token?: string } | null;
      if (!res.ok || !data?.token) {
        setError(leerErrorPlataforma(data));
        return;
      }
      setNuevo(data.token);
      setCopiado(null);
      setName("");
      router.refresh();
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-4">
      <Seccion
        titulo="Nuevo token"
        descripcion="Para la API (Authorization: Bearer alp_…) y el servidor MCP. Cada acción queda en la auditoría con tu nombre y el del token."
      >
        <form onSubmit={crear} className="space-y-2">
          <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
            <Campo etiqueta="Nombre (para reconocerlo)">
              {(id) => <Input id={id} required maxLength={60} placeholder="Claude de Ana" value={name} onChange={(e) => setName(e.target.value)} />}
            </Campo>
            <Campo etiqueta="Vence en (días)" ayuda="Vacío = no vence.">
              {(id) => <Input id={id} type="number" min={1} max={365} value={dias} onChange={(e) => setDias(e.target.value)} />}
            </Campo>
          </div>
          <FilaInterruptor
            titulo="Puede aprovisionar"
            descripcion="Crear y cambiar negocios, invitar y suspender. Sin esto, solo lee y planifica."
            checked={provision}
            onChange={setProvision}
          />
          <Button type="submit" disabled={ocupado}>
            <KeyRound className="mr-1.5 h-4 w-4" /> Crear token
          </Button>
        </form>
        {nuevo && (
          <div className="space-y-2 rounded-lg border border-warning-soft bg-warning-tint p-3 text-sm">
            <p className="font-medium text-warning-text">Copia el token ahora: no se puede volver a mostrar.</p>
            <code className="block select-all break-all rounded bg-background p-2 font-mono text-xs">{nuevo}</code>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" type="button" onClick={async () => setCopiado(await copiarAlPortapapeles(nuevo))}>
                {copiado ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
                {copiado ? "Copiado" : "Copiar"}
              </Button>
              {copiado === false && <span className="text-xs text-danger-text">{COPIA_MANUAL}</span>}
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint p-3 text-sm text-danger-text">
            {error}
          </p>
        )}
      </Seccion>

      <Seccion titulo={`Tus tokens (${inicial.length})`}>
        {inicial.length === 0 ? (
          <p className="text-sm text-text-3">Aún no tienes tokens.</p>
        ) : (
          <ul className="divide-y text-sm">
            {inicial.map((t) => {
              const estado = estadoToken(t);
              const insignia = INSIGNIA_ESTADO[estado];
              return (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {t.name}
                      <span className="font-mono text-xs text-text-3">…{t.last4}</span>
                      <Badge variant={insignia.variante}>{insignia.texto}</Badge>
                      {t.scopes.map((s) => (
                        <span key={s} className="rounded-md bg-subtle px-1.5 py-0.5 text-[11px] font-normal text-text-2">
                          {s}
                        </span>
                      ))}
                    </p>
                    <p className="text-xs text-text-3">
                      Último uso {fecha(t.lastUsedAt, locale)} · vence {fecha(t.expiresAt, locale)}
                      {t.revokedAt ? ` · revocado ${fecha(t.revokedAt, locale)}` : ""}
                    </p>
                  </div>
                  {estado === "vigente" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={ocupado}
                      onClick={async () => {
                        if (!window.confirm(`¿Revocar «${t.name}»? Deja de funcionar de inmediato.`)) return;
                        const res = await fetch(`/api/platform/tokens/${t.id}`, { method: "DELETE" });
                        if (res.ok) router.refresh();
                        else setError("No se pudo revocar.");
                      }}
                    >
                      Revocar
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Seccion>
    </div>
  );
}
