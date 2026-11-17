import { CURRENCY_OPTIONS } from "@/lib/money";
import { getRegion } from "@/lib/region";
import { DEFAULT_BRANDING } from "@/lib/branding";
import { dominioBase } from "@/lib/tenancy";
import { AltaNegocio } from "@/components/plataforma/alta-negocio";

export const dynamic = "force-dynamic";

/**
 * 069 (US2) — Alta de un negocio. El formulario arma un
 * `OrganizationBlueprint` y lo manda a `POST /api/platform/organizations`:
 * el mismo contrato que usan la API y el MCP.
 */
export default function NuevoNegocioPage() {
  const region = getRegion();
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
    />
  );
}
