import { listarDespliegues } from "@/server/brains/deployment";
import { getRegion } from "@/lib/region";
import { DEFAULT_BRANDING } from "@/lib/branding";
import { dominioBase } from "@/lib/tenancy";
import { FormularioBlueprint } from "@/components/plataforma/formulario/formulario-blueprint";
import { EncabezadoPagina } from "@/components/plataforma/shell-plataforma";
import { ETAPAS_POR_DEFECTO } from "@/server/platform/catalogo";
import { techoDeInstancia } from "@/server/modulos/efectivos";

export const dynamic = "force-dynamic";

/**
 * 069 (US2, US8) — Alta de un negocio. El formulario arma un
 * `OrganizationBlueprint` y lo manda a `POST /api/platform/organizations`:
 * el mismo contrato que usan la API y el MCP (auditoría 069, Fix-C).
 */
export default async function NuevoNegocioPage() {
  const region = getRegion();
  const techo = techoDeInstancia();
  return (
    <>
      <EncabezadoPagina
        titulo="Nuevo negocio"
        descripcion="Configúralo completo aquí o solo lo básico: todo se puede cambiar después desde su ficha (salvo la dirección)."
      />
      <FormularioBlueprint
        modo="crear"
        dominio={dominioBase()}
        defaults={{
          country: region.country,
          locale: region.locale,
          timezone: region.timezone,
          currency: region.currency,
          accent: DEFAULT_BRANDING.accent,
          etapas: [...ETAPAS_POR_DEFECTO.open],
        }}
        techo={{ agenda: techo.agenda, atribucion: techo.atribucion, channels: [...techo.channels] }}
        cerebros={(await listarDespliegues()).map((c) => ({ id: c.id, name: c.name, status: c.status }))}
      />
    </>
  );
}
