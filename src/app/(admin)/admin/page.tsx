import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { hace, numero, type Tono } from "@/components/panel/formato";
import { GastoResumen, type FilaDeGasto } from "@/components/panel/gasto-resumen";
import { Cifra, Encabezado, Punto, Seccion } from "@/components/panel/piezas";
import { APP_VERSION, resolveCommit } from "@/lib/version";
import { urlSaludCerebro } from "@/server/brains/config";
import { getBrainHealth } from "@/server/bot/status";
import { negociosDelPanel, saludDelPanel, type NegocioDelPanel, type SaludDelPanel } from "@/server/panel/datos";
import { gastoDelCerebro } from "@/server/panel/gasto";
import { paginaDelPanel } from "@/server/panel/ruta";

export const dynamic = "force-dynamic";

/**
 * 076 (D16) — El resumen del panel de Andres: salud técnica de la instalación
 * (sin una sola línea de texto de mensajes) y lo que pide atención. Todo sale
 * de `vocero_panel_*` (agregados) y del `/health` del cerebro.
 */
type Fila = { nombre: string; detalle: string; tono: Tono };

function filasDeServicios(salud: SaludDelPanel, cerebro: Awaited<ReturnType<typeof getBrainHealth>>): Fila[] {
  const commit = resolveCommit();
  return [
    {
      nombre: "Vocero y su base de datos",
      detalle: `Responde · versión ${APP_VERSION}${commit.commit ? ` (${commit.commit})` : ""}`,
      tono: "verde",
    },
    cerebro === null
      ? { nombre: "Cerebro", detalle: "Sin configurar (BRAIN_DISPATCH_URL)", tono: "gris" }
      : {
          nombre: "Cerebro",
          detalle: cerebro.reachable
            ? `Responde · versión ${cerebro.version ?? "?"}${cerebro.commit ? ` (${cerebro.commit.slice(0, 7)})` : ""}`
            : `No responde (${cerebro.problem ?? cerebro.httpStatus ?? "sin respuesta"})`,
          tono: cerebro.reachable ? "verde" : "rojo",
        },
    {
      nombre: "Webhooks",
      detalle: `${numero(salud.webhooksPendientes)} por procesar · ${numero(salud.webhooksAgotados)} agotados`,
      tono: salud.webhooksAgotados > 0 ? "rojo" : salud.webhooksPendientes > 20 ? "ambar" : "verde",
    },
    {
      nombre: "Despacho al cerebro",
      detalle: `${numero(salud.despachosPendientes)} en espera · ${numero(salud.despachosEnVuelo)} en vuelo · ${numero(salud.despachosVencidos)} atrasados`,
      tono: salud.despachosVencidos > 0 ? "ambar" : "verde",
    },
    {
      nombre: "Borrados pendientes («No acepto»)",
      detalle: `${numero(salud.olvidosPendientes)} por reintentar`,
      tono: salud.olvidosPendientes > 0 ? "ambar" : "verde",
    },
    {
      nombre: "Avisos al personal",
      detalle: `${numero(salud.avisosPendientes)} sin enviar`,
      tono: salud.avisosPendientes > 0 ? "ambar" : "verde",
    },
    {
      nombre: "Último mensaje entrante",
      detalle: hace(salud.ultimoEntranteEn),
      tono: "gris",
    },
  ];
}

type Alerta = { negocio: NegocioDelPanel; motivo: string };

function alertas(negocios: NegocioDelPanel[]): Alerta[] {
  const out: Alerta[] = [];
  for (const n of negocios) {
    const canal = Object.values(n.canales).some(Boolean);
    if (n.pausadoEn) out.push({ negocio: n, motivo: "Pausado" });
    else if (!canal) out.push({ negocio: n, motivo: "Sin ningún canal conectado" });
    else if (n.agenteEncendido && n.conversaciones7d === 0) {
      out.push({ negocio: n, motivo: "Agente encendido y sin mensajes en 7 días" });
    }
    if (n.webhooksAgotados > 0) out.push({ negocio: n, motivo: `${n.webhooksAgotados} webhooks agotados` });
  }
  return out;
}

async function Resumen() {
  const [salud, negocios] = await Promise.all([saludDelPanel(), negociosDelPanel()]);
  const [cerebro, gasto] = await Promise.all([
    getBrainHealth(urlSaludCerebro() ?? undefined).catch(() => null),
    gastoDelCerebro(),
  ]);
  const nombres = new Map(negocios.map((n) => [n.id, n.nombre]));
  const filasDeGasto: FilaDeGasto[] | null = gasto
    ? gasto.negocios.map((g) => ({
        id: g.organizationId,
        nombre: nombres.get(g.organizationId) ?? "(no está en Vocero)",
        hoyUsd: g.hoyUsd,
        mesUsd: g.mesUsd,
        topeUsd: g.topeDiarioUsd,
        pruebasHoyUsd: g.pruebasHoyUsd,
        fallidasHoy: g.fallidasHoy,
      }))
    : null;
  const activos = negocios.filter((n) => !n.pausadoEn).length;
  const entrantes = negocios.reduce((s, n) => s + n.entrantes24h, 0);
  const conversaciones7d = negocios.reduce((s, n) => s + n.conversaciones7d, 0);
  const atencion = alertas(negocios);

  return (
    <div className="mx-auto max-w-5xl">
      <Encabezado titulo="Resumen" descripcion="Salud de la instalación y lo que pide atención. Sin conversaciones." />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra etiqueta="Negocios activos" valor={numero(activos)} nota={`${numero(salud.pausados)} pausados`} />
        <Cifra etiqueta="Entrantes 24 h" valor={numero(entrantes)} />
        <Cifra etiqueta="Conversaciones 7 días" valor={numero(conversaciones7d)} />
        <Cifra etiqueta="Negocios en total" valor={numero(salud.negocios)} />
      </div>

      <GastoResumen filas={filasDeGasto} />

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Seccion titulo="Servicios">
          <ul className="divide-y">
            {filasDeServicios(salud, cerebro).map((f) => (
              <li key={f.nombre} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                <Punto tono={f.tono} className="mt-1.5" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{f.nombre}</p>
                  <p className="text-sm text-text-3">{f.detalle}</p>
                </div>
              </li>
            ))}
          </ul>
        </Seccion>

        <Seccion
          titulo="Atención"
          accion={
            <Link href="/admin/negocios" className="flex items-center gap-1 text-sm font-semibold text-brand-ink">
              Negocios <ArrowRight className="size-4" aria-hidden />
            </Link>
          }
        >
          {atencion.length === 0 ? (
            <p className="text-sm text-text-3">Nada pendiente.</p>
          ) : (
            <ul className="divide-y">
              {atencion.map((a, i) => (
                <li key={`${a.negocio.id}-${i}`} className="py-2.5 first:pt-0 last:pb-0">
                  <Link href={`/admin/negocios/${a.negocio.id}`} className="block">
                    <p className="text-sm font-semibold">{a.negocio.nombre}</p>
                    <p className="text-sm text-text-3">{a.motivo}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Seccion>
      </div>
    </div>
  );
}

export default paginaDelPanel(Resumen);
