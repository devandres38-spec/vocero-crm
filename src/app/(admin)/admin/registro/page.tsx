import Link from "next/link";
import { ACCIONES, fechaHora } from "@/components/panel/formato";
import { Encabezado } from "@/components/panel/piezas";
import { registroDelPanel } from "@/server/panel/datos";
import { paginaDelPanel } from "@/server/panel/ruta";

export const dynamic = "force-dynamic";

/** 076 — Lo que hizo Andres desde el panel (solo de adición; las últimas 200). */
async function Registro() {
  const entradas = await registroDelPanel(200);
  return (
    <div className="mx-auto max-w-4xl">
      <Encabezado titulo="Registro" descripcion="Lo que se hizo desde este panel. No se puede editar ni borrar." />
      {entradas.length === 0 ? (
        <p className="text-sm text-text-3">Todavía no hay acciones.</p>
      ) : (
        <ol className="divide-y rounded-lg border border-border-strong bg-card shadow-sm">
          {entradas.map((e, i) => {
            const correo = typeof e.detalle.correo === "string" ? e.detalle.correo : null;
            return (
              <li key={`${e.cuando}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{ACCIONES[e.accion] ?? e.accion}</p>
                  <p className="text-sm text-text-3">
                    {e.negocioId ? (
                      <Link href={`/admin/negocios/${e.negocioId}`} className="hover:underline">
                        {e.nombre ?? "(negocio borrado)"}
                      </Link>
                    ) : (
                      "—"
                    )}
                    {correo && ` · ${correo}`}
                  </p>
                </div>
                <time className="text-xs tabular-nums text-text-3" dateTime={e.cuando}>
                  {fechaHora(e.cuando)}
                </time>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export default paginaDelPanel(Registro);
