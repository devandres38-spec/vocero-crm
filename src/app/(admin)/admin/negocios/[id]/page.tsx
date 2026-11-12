import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { dolares, fechaCorta, hace, numero, ROLES } from "@/components/panel/formato";
import { AccionesDeUsuario, PausarNegocio, TopeLaboratorio } from "@/components/panel/acciones-negocio";
import { Cifra, Encabezado, Seccion } from "@/components/panel/piezas";
import { negociosDelPanel, usuariosDelPanel } from "@/server/panel/datos";
import { gastoDelCerebro } from "@/server/panel/gasto";
import { paginaDelPanel } from "@/server/panel/ruta";

export const dynamic = "force-dynamic";

/**
 * 076 — Un negocio en el panel: sus conteos y su personal (nombre, correo,
 * rol, última sesión). Nunca sus pacientes ni sus conversaciones.
 */
async function Negocio(
  _superadmin: unknown,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) notFound();
  const negocio = (await negociosDelPanel()).find((n) => n.id === id);
  if (!negocio) notFound();
  const [usuarios, gasto] = await Promise.all([usuariosDelPanel(id), gastoDelCerebro()]);
  const suGasto = gasto?.negocios.find((g) => g.organizationId === id) ?? null;
  const duenos = usuarios.filter((u) => u.rol === "owner").length;

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/admin/negocios" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-text-3">
        <ArrowLeft className="size-4" aria-hidden /> Negocios
      </Link>
      <Encabezado
        titulo={negocio.nombre}
        descripcion={`Alta el ${fechaCorta(negocio.creadoEn)} · id ${negocio.id}`}
        accion={
          <div className="flex flex-wrap items-center gap-3">
            {negocio.pausadoEn ? <Badge variant="destructive">Pausado</Badge> : <Badge variant="success">Activo</Badge>}
            <PausarNegocio id={negocio.id} nombre={negocio.nombre} pausado={negocio.pausadoEn !== null} />
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra
          etiqueta="Gasto LLM hoy"
          valor={suGasto ? dolares(suGasto.hoyUsd) : "—"}
          nota={
            suGasto
              ? `tope ${suGasto.topeDiarioUsd === null ? "sin configurar en el cerebro" : dolares(suGasto.topeDiarioUsd)} · mes ${dolares(suGasto.mesUsd)}`
              : gasto
                ? "sin uso del LLM"
                : "el cerebro no respondió"
          }
        />
        <Cifra etiqueta="Conversaciones" valor={numero(negocio.conversaciones)} nota={`${numero(negocio.conversaciones7d)} en 7 días`} />
        <Cifra etiqueta="Entrantes 24 h" valor={numero(negocio.entrantes24h)} nota={`último ${hace(negocio.ultimoEntranteEn)}`} />
        <Cifra etiqueta="A una persona 24 h" valor={numero(negocio.aHumano24h)} nota={`${numero(negocio.despachosPendientes)} despachos en espera`} />
        <Cifra
          etiqueta="Retención"
          valor={negocio.retencionDias === null ? "—" : `${negocio.retencionDias} días`}
          nota={negocio.retencionDias === null ? "sin perfil de privacidad" : undefined}
        />
        <Cifra
          etiqueta="Laboratorio"
          valor={`${numero(negocio.laboratorio.corridasHoy)} de ${numero(negocio.laboratorio.tope)}`}
          nota={negocio.laboratorio.tope === 0 ? "apagado" : "corridas hoy (UTC)"}
        />
      </div>

      <Seccion titulo="Laboratorio">
        <p className="mb-3 text-sm text-text-3">
          Laboratorio: {negocio.laboratorio.corridasHoy} de {negocio.laboratorio.tope} corridas hoy. Cada
          corrida paga el juez con la llave de Aliantis y los turnos del cerebro.
        </p>
        <TopeLaboratorio id={negocio.id} tope={negocio.laboratorio.tope} />
      </Seccion>

      <Seccion titulo={`Usuarios (${usuarios.length})`}>
        <ul className="divide-y">
          {usuarios.map((u) => (
            <li key={u.userId} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {u.nombre} <span className="font-normal text-text-3">· {ROLES[u.rol] ?? u.rol}</span>
                </p>
                <p className="truncate text-sm text-text-3">{u.correo}</p>
                <p className="text-xs text-text-3">
                  Última sesión: {hace(u.ultimaSesionEn)}
                  {u.debeCambiarContrasena && " · debe cambiar su contraseña"}
                </p>
              </div>
              <AccionesDeUsuario
                negocioId={negocio.id}
                userId={u.userId}
                correo={u.correo}
                puedeQuitarse={!(u.rol === "owner" && duenos <= 1)}
              />
            </li>
          ))}
        </ul>
      </Seccion>
    </div>
  );
}

export default paginaDelPanel(Negocio);
