import { GestorCerebros } from "@/components/plataforma/gestor-cerebros";
import { EncabezadoPagina } from "@/components/plataforma/shell-plataforma";
import { requirePlataformaPagina } from "@/server/platform/guardia";
import { listarDespliegues } from "@/server/brains/deployment";

export const dynamic = "force-dynamic";

/**
 * 070 (US1) — Los cerebros de la plataforma: cada uno es una Nea `multiorg`
 * que atiende a los negocios que se le asignen desde su ficha.
 */
export default async function CerebrosPage() {
  await requirePlataformaPagina();
  return (
    <>
      <EncabezadoPagina
        titulo="Cerebros"
        descripcion="Los agentes que contestan por los negocios. El secreto de cada uno se muestra una sola vez."
      />
      <GestorCerebros inicial={await listarDespliegues()} />
    </>
  );
}
