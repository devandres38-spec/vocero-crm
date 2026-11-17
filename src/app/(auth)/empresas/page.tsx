import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { dominioBase, esPlataforma } from "@/lib/tenancy";
import { SelectorEmpresas } from "@/components/plataforma/selector-empresas";
import { esSuperAdmin, membresiasDe } from "@/server/tenant/consultas";

export const dynamic = "force-dynamic";

/**
 * 069 (US3) — Las empresas de la persona. En modo plataforma, cada una vive en
 * su subdominio (ahí el host decide la organización); sin dominio base, se
 * elige como organización activa de la sesión. En `single` no existe.
 */
export default async function EmpresasPage() {
  if (!esPlataforma()) redirect("/");
  const s = await getAuth().api.getSession({ headers: await headers() });
  if (!s) redirect("/login");
  const [empresas, admin] = await Promise.all([membresiasDe(s.user.id), esSuperAdmin(s.user.id)]);
  return (
    <SelectorEmpresas
      base={dominioBase()}
      superAdmin={admin}
      empresas={empresas.map((e) => ({
        organizationId: e.organizationId,
        name: e.name,
        slug: e.slug,
        role: e.role,
        suspendida: e.status === "suspendida",
      }))}
    />
  );
}
