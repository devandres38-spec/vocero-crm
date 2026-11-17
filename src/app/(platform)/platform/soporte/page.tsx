import { raizPlataforma } from "@/lib/tenancy";
import { GestorSoporte } from "@/components/plataforma/gestor-soporte";
import { listarOrganizaciones } from "@/server/platform/organizaciones";
import { listarAccesos, MAX_HORAS_SOPORTE } from "@/server/platform/soporte";

export const dynamic = "force-dynamic";

/**
 * 069 (US5) — Accesos de soporte: pedir uno (nivel, motivo, caducidad) y
 * cerrarlo. Para entrar, se abre el subdominio del negocio mientras dure.
 */
export default async function SoportePage() {
  const [orgs, accesos] = await Promise.all([listarOrganizaciones(), listarAccesos()]);
  return (
    <GestorSoporte
      raiz={raizPlataforma()}
      maxHoras={MAX_HORAS_SOPORTE}
      organizaciones={orgs.map((o) => ({ id: o.id, name: o.name, slug: o.slug }))}
      accesos={accesos}
    />
  );
}
