import { TeamClient } from "@/components/settings/team-client";
import { CambiosPlataforma } from "@/components/settings/cambios-plataforma";
import { canConfigure } from "@/lib/auth/roles";
import { getSessionOrNull } from "@/lib/auth/session";
import { esPlataforma } from "@/lib/tenancy";
import { cambiosDeLaPlataforma } from "@/server/platform/cambios";
import { accesosDeOrganizacion } from "@/server/platform/soporte";
import { AccesosSoporte } from "@/components/settings/accesos-soporte";

export const dynamic = "force-dynamic";

export default async function TeamSettingsPage() {
  // 069 — En modo plataforma, quien administra el negocio ve qué cambió la
  // agencia (y, desde la US5, quién entró con acceso de soporte).
  const session = await getSessionOrNull();
  const ve = esPlataforma() && session && canConfigure(session.role) ? session : null;
  const [cambios, accesos] = ve
    ? await Promise.all([cambiosDeLaPlataforma(ve.organizationId), accesosDeOrganizacion(ve.organizationId)])
    : [null, null];
  return (
    <div className="space-y-6">
      <TeamClient />
      {accesos && <AccesosSoporte accesos={accesos} />}
      {cambios && <CambiosPlataforma cambios={cambios} />}
    </div>
  );
}
