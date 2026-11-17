import { TeamClient } from "@/components/settings/team-client";
import { CambiosPlataforma } from "@/components/settings/cambios-plataforma";
import { canConfigure } from "@/lib/auth/roles";
import { getSessionOrNull } from "@/lib/auth/session";
import { esPlataforma } from "@/lib/tenancy";
import { cambiosDeLaPlataforma } from "@/server/platform/cambios";

export const dynamic = "force-dynamic";

export default async function TeamSettingsPage() {
  // 069 — En modo plataforma, quien administra el negocio ve qué cambió la
  // agencia (y, desde la US5, quién entró con acceso de soporte).
  const session = await getSessionOrNull();
  const cambios =
    esPlataforma() && session && canConfigure(session.role)
      ? await cambiosDeLaPlataforma(session.organizationId)
      : null;
  return (
    <div className="space-y-6">
      <TeamClient />
      {cambios && <CambiosPlataforma cambios={cambios} />}
    </div>
  );
}
