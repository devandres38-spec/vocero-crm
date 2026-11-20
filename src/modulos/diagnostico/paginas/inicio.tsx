import Link from "next/link";
import { urlDeConversacion } from "@/lib/avisos-sistema";
import { exigirModulo } from "@/server/modulos/guardas";
import { herramientasDe } from "@/modulos/registro";
import { ultimasMarcas } from "../consultas";
import { DIAGNOSTICO } from "../modulo";

/**
 * 072-B (D18) — `/m/diagnostico`: lo mínimo para ver el módulo vivo en
 * staging. Qué herramientas le anuncia al cerebro y las últimas marcas que el
 * cerebro dejó con `diagnostico_marca`.
 */
export default async function DiagnosticoInicio() {
  // El layout ya cortó con 404 si el módulo está apagado; aquí se vuelve a
  // pedir solo para tener la organización (la sesión va en caché por petición).
  const session = await exigirModulo(DIAGNOSTICO.clave);
  const marcas = await ultimasMarcas(session.organizationId);
  const herramientas = herramientasDe(DIAGNOSTICO.clave);

  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-4 py-3 sm:px-6 sm:py-4">
        <h2 className="text-[17px] font-bold tracking-tight">{DIAGNOSTICO.etiqueta}</h2>
        <p className="text-sm text-text-2">{DIAGNOSTICO.descripcion}</p>
      </header>
      <div className="flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
        <section>
          <h3 className="kicker mb-2">Herramientas que ve el cerebro</h3>
          <ul className="space-y-2 text-sm">
            {herramientas.map((h) => (
              <li key={h.nombre} className="rounded-md border p-3">
                <p className="font-mono text-[13px]">
                  {h.nombre} <span className="text-text-3">· {h.efecto}</span>
                </p>
                <p className="text-text-2">{h.descripcion}</p>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="kicker mb-2">Últimas marcas</h3>
          {marcas.length === 0 ? (
            <p className="text-sm text-text-3">El cerebro todavía no ha dejado ninguna marca.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {marcas.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3">
                  <Link href={urlDeConversacion(m.conversationId)} className="min-w-0 truncate hover:underline">
                    {m.texto}
                  </Link>
                  <time className="shrink-0 text-xs tabular-nums text-text-3" dateTime={m.createdAt.toISOString()}>
                    {m.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                  </time>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
