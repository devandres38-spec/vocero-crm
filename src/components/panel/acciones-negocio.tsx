"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ContrasenaUnaVez } from "./contrasena-una-vez";

/**
 * 076 — Las acciones del panel sobre un negocio: pausar o activar (con el
 * nombre escrito como confirmación) y, por cada cuenta del personal,
 * restablecer la contraseña o quitarla (nunca al último dueño).
 */
async function pedir(url: string, method: "POST" | "PUT" | "DELETE", cuerpo?: unknown) {
  const r = await fetch(url, {
    method,
    headers: cuerpo ? { "Content-Type": "application/json" } : undefined,
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const datos = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  const mensaje = (datos?.error as { message?: string } | undefined)?.message;
  return { ok: r.ok, datos, mensaje };
}

export function PausarNegocio({ id, nombre, pausado }: { id: string; nombre: string; pausado: boolean }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [confirmacion, setConfirmacion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    const r = await pedir(`/api/admin/negocios/${id}/pausa`, "POST", { pausar: !pausado, confirmacion });
    setEnviando(false);
    if (!r.ok) return setError(r.mensaje ?? "No se pudo");
    setAbierto(false);
    setConfirmacion("");
    router.refresh();
  }

  if (!abierto) {
    return (
      <Button
        type="button"
        variant={pausado ? "default" : "outline"}
        className="min-h-11"
        onClick={() => setAbierto(true)}
      >
        {pausado ? "Activar negocio" : "Pausar negocio"}
      </Button>
    );
  }
  return (
    <form onSubmit={confirmar} className="space-y-3 rounded-md border border-border-strong p-4">
      <p className="text-sm">
        {pausado
          ? "Su personal vuelve a entrar con su contraseña de siempre y el bot vuelve a contestar."
          : "Su personal no podrá entrar y el bot dejará de contestar (salvo lo de salud y urgencias). Los mensajes se siguen guardando y la retención y los borrados siguen corriendo."}
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="confirmacion">
          Escribe <span className="font-semibold">{nombre}</span> para confirmar
        </Label>
        <Input id="confirmacion" value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} autoComplete="off" />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          variant={pausado ? "default" : "destructive"}
          className="min-h-11"
          disabled={enviando || confirmacion.trim() !== nombre.trim()}
        >
          {pausado ? "Activar" : "Pausar"}
        </Button>
        <Button type="button" variant="ghost" className="min-h-11" onClick={() => setAbierto(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

/** 080 (D20) — El tope diario del Laboratorio de un negocio, de 0 a 20. */
export function TopeLaboratorio({ id, tope }: { id: string; tope: number }) {
  const router = useRouter();
  const [valor, setValor] = useState(String(tope));
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const n = Number(valor);
  const valido = valor.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= 20;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    const r = await pedir(`/api/admin/negocios/${id}/laboratorio`, "PUT", { tope: n });
    setEnviando(false);
    if (!r.ok) return setError(r.mensaje ?? "No se pudo");
    router.refresh();
  }

  return (
    <form onSubmit={guardar} className="flex flex-wrap items-end gap-2">
      <div className="space-y-1.5">
        <Label htmlFor="tope-laboratorio">Corridas por día (0 a 20; 0 lo apaga)</Label>
        <Input
          id="tope-laboratorio"
          type="number"
          inputMode="numeric"
          min={0}
          max={20}
          step={1}
          className="w-28"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
        />
      </div>
      <Button type="submit" variant="outline" className="min-h-11" disabled={enviando || !valido || n === tope}>
        Guardar
      </Button>
      {error && <p className="w-full text-sm text-destructive">{error}</p>}
    </form>
  );
}

export function AccionesDeUsuario({
  negocioId,
  userId,
  correo,
  puedeQuitarse,
}: {
  negocioId: string;
  userId: string;
  correo: string;
  puedeQuitarse: boolean;
}) {
  const router = useRouter();
  const [contrasena, setContrasena] = useState<string | null>(null);
  const [quitando, setQuitando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const base = `/api/admin/negocios/${negocioId}/usuarios/${userId}`;

  async function restablecer() {
    setError(null);
    setEnviando(true);
    const r = await pedir(`${base}/contrasena`, "POST");
    setEnviando(false);
    if (!r.ok) return setError(r.mensaje ?? "No se pudo");
    setContrasena(String(r.datos?.contrasena ?? ""));
    router.refresh();
  }

  async function quitar() {
    setError(null);
    setEnviando(true);
    const r = await pedir(base, "DELETE");
    setEnviando(false);
    if (!r.ok) return setError(r.mensaje ?? "No se pudo");
    setQuitando(false);
    router.refresh();
  }

  return (
    <div className="w-full space-y-2 sm:w-auto">
      {contrasena ? (
        <ContrasenaUnaVez contrasena={contrasena} para={correo} />
      ) : quitando ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">¿Quitar la cuenta de {correo}?</span>
          <Button type="button" variant="destructive" size="sm" className="min-h-11" disabled={enviando} onClick={quitar}>
            Quitar
          </Button>
          <Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={() => setQuitando(false)}>
            Cancelar
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={enviando} onClick={restablecer}>
            Restablecer contraseña
          </Button>
          {puedeQuitarse && (
            <Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={() => setQuitando(true)}>
              Quitar cuenta
            </Button>
          )}
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
