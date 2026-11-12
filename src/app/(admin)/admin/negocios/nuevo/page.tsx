import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AltaDeNegocio } from "@/components/panel/alta-negocio";
import { Encabezado, Seccion } from "@/components/panel/piezas";
import { paginaDelPanel } from "@/server/panel/ruta";

export const dynamic = "force-dynamic";

/** 076 — Alta de un negocio desde el panel (la misma `crearNegocio()` del comando). */
async function Nuevo() {
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/admin/negocios" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-text-3">
        <ArrowLeft className="size-4" aria-hidden /> Negocios
      </Link>
      <Encabezado
        titulo="Nuevo negocio"
        descripcion="Crea el negocio, su dueño, las etapas del pipeline y el perfil del agente, todo de una vez."
      />
      <Seccion titulo="Datos">
        <AltaDeNegocio />
      </Seccion>
    </div>
  );
}

export default paginaDelPanel(Nuevo);
