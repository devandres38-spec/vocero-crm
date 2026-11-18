import { BrandingClient } from "@/components/settings/branding-client";
import { FaviconCard } from "@/components/settings/favicon-card";
import { getBranding } from "@/server/branding";
import { getSessionOrNull } from "@/lib/auth/session";
import { navKicker } from "@/lib/channels";
import { modulosDe } from "@/server/modulos/consulta";
import { canConfigure } from "@/lib/auth/roles";
import { esPlataforma } from "@/lib/tenancy";
import { getRegionDeOrganizacion } from "@/server/region";
import { RegionNegocio } from "@/components/settings/region-negocio";

export const dynamic = "force-dynamic";

export default async function BrandingSettingsPage() {
  // La marca se lee en el servidor para que la tarjeta del icono ya pinte la
  // vista previa correcta en el primer render, sin un parpadeo del generado al
  // subido mientras un fetch del cliente va y vuelve.
  const session = await getSessionOrNull();
  const branding = await getBranding(session?.organizationId);
  // 069 (US6) — En modo plataforma la región es de cada negocio.
  const region = esPlataforma() && session ? await getRegionDeOrganizacion(session.organizationId) : null;

  return (
    <div className="max-w-2xl space-y-6">
      {/* El logo viaja como prop: al subirlo o quitarlo, FaviconCard refresca
          la página y la vista previa de la marca lo sigue sin recargar. */}
      <BrandingClient
        favicon={branding.favicon}
        kicker={navKicker(modulosDe(session).channels)}
      />
      <FaviconCard branding={branding} />
      {region && <RegionNegocio inicial={region} editable={canConfigure(session?.role)} />}
    </div>
  );
}
