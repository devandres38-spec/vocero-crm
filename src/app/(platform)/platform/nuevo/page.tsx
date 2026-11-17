import { CURRENCY_OPTIONS } from "@/lib/money";
import { getRegion } from "@/lib/region";
import { DEFAULT_BRANDING } from "@/lib/branding";
import { dominioBase } from "@/lib/tenancy";
import { AltaNegocio } from "@/components/plataforma/alta-negocio";
import { techoDeInstancia } from "@/server/modulos/efectivos";

export const dynamic = "force-dynamic";

/**
 * 069 (US2, US8) — Alta de un negocio. El asistente arma un
 * `OrganizationBlueprint` y lo manda a `POST /api/platform/organizations`:
 * el mismo contrato que usan la API y el MCP.
 */
export default function NuevoNegocioPage() {
  const region = getRegion();
  const techo = techoDeInstancia();
  return (
    <AltaNegocio
      base={dominioBase()}
      defaults={{
        country: region.country,
        locale: region.locale,
        timezone: region.timezone,
        currency: region.currency,
        accent: DEFAULT_BRANDING.accent,
      }}
      monedas={CURRENCY_OPTIONS.map((c) => ({ code: c.code, label: `${c.code} — ${c.name}` }))}
      techo={{ agenda: techo.agenda, atribucion: techo.atribucion, channels: [...techo.channels] }}
    />
  );
}
