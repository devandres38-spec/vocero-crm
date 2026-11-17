"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { leerErrorPlataforma } from "@/components/plataforma/errores";

type Token = {
  id: string;
  name: string;
  last4: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

const fecha = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

/** 069 (D14) — Crear y revocar tokens personales. El token se ve UNA vez. */
export function GestorTokens({ inicial }: { inicial: Token[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [provision, setProvision] = useState(false);
  const [dias, setDias] = useState("90");
  const [nuevo, setNuevo] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
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
      setCopiado(false);
      setName("");
      router.refresh();
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Nuevo token</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-text-2">
            Para la API (`Authorization: Bearer alp_…`) y el servidor MCP. Cada acción queda en la auditoría con tu
            nombre y el del token.
          </p>
          <form onSubmit={crear} className="flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1 space-y-1.5">
              <Label htmlFor="tok-nombre">Nombre (para reconocerlo)</Label>
              <Input id="tok-nombre" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tok-dias">Vence en (días, vacío = no vence)</Label>
              <Input id="tok-dias" type="number" min={1} max={365} value={dias} onChange={(e) => setDias(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 pb-2">
              <input type="checkbox" checked={provision} onChange={(e) => setProvision(e.target.checked)} />
              <span>Puede aprovisionar (crear y cambiar negocios)</span>
            </label>
            <Button type="submit" disabled={ocupado}>
              Crear token
            </Button>
          </form>
          {nuevo && (
            <div className="space-y-2 rounded-md border border-warning-soft bg-warning-tint p-3">
              <p className="font-medium text-warning-text">Copia el token ahora: no se puede volver a mostrar.</p>
              <code className="block break-all rounded bg-background p-2 font-mono text-xs">{nuevo}</code>
              <Button
                size="sm"
                onClick={async () => {
                  await navigator.clipboard.writeText(nuevo).catch(() => undefined);
                  setCopiado(true);
                }}
              >
                {copiado ? "Copiado" : "Copiar"}
              </Button>
            </div>
          )}
          {error && (
            <p role="alert" className="text-danger-text">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tus tokens</CardTitle>
        </CardHeader>
        <CardContent>
          {inicial.length === 0 ? (
            <p className="text-sm text-text-3">Aún no tienes tokens.</p>
          ) : (
            <ul className="divide-y text-sm">
              {inicial.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {t.name} <span className="font-mono text-xs text-text-3">…{t.last4}</span>
                    </p>
                    <p className="text-xs text-text-3">
                      {t.scopes.join(" + ")} · último uso {fecha(t.lastUsedAt)} · vence {fecha(t.expiresAt)}
                      {t.revokedAt ? ` · revocado ${fecha(t.revokedAt)}` : ""}
                    </p>
                  </div>
                  {!t.revokedAt && (
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
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
