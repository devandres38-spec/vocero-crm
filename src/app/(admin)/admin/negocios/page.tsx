import Link from "next/link";
import { Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Encabezado } from "@/components/panel/piezas";
import { TablaDeNegocios, type FilaDeNegocio } from "@/components/panel/tabla-negocios";
import { cn } from "@/lib/utils";
import { negociosDelPanel } from "@/server/panel/datos";
import { paginaDelPanel } from "@/server/panel/ruta";

export const dynamic = "force-dynamic";

/** 076 — Los negocios de la instalación, con conteos (respuesta 4: cuántas cuentas tiene cada uno). */
async function Negocios() {
  const negocios = await negociosDelPanel();
  const filas: FilaDeNegocio[] = negocios.map((n) => ({
    id: n.id,
    nombre: n.nombre,
    pausadoEn: n.pausadoEn,
    agenteEncendido: n.agenteEncendido,
    canales: n.canales,
    usuarios: n.usuarios,
    conversaciones: n.conversaciones,
    entrantes24h: n.entrantes24h,
    creadoEn: n.creadoEn,
    gasto: null,
  }));
  return (
    <div className="mx-auto max-w-6xl">
      <Encabezado
        titulo="Negocios"
        descripcion={`${negocios.length} en la instalación. Solo conteos: el panel no ve conversaciones.`}
        accion={
          <Link href="/admin/negocios/nuevo" className={cn(buttonVariants(), "min-h-11 gap-1.5")}>
            <Plus className="size-4" aria-hidden />
            Nuevo negocio
          </Link>
        }
      />
      <TablaDeNegocios filas={filas} />
    </div>
  );
}

export default paginaDelPanel(Negocios);
