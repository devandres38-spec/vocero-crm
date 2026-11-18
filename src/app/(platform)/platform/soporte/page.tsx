import { requirePlataformaPagina } from "@/server/platform/guardia";
import { GestorSoporte } from "@/components/plataforma/gestor-soporte";
import { EncabezadoPagina } from "@/components/plataforma/shell-plataforma";
import { listarOrganizaciones } from "@/server/platform/organizaciones";
import { listarAccesos, MAX_HORAS_SOPORTE } from "@/server/platform/soporte";

export const dynamic = "force-dynamic";

/**
 * 069 (US5) — Accesos de soporte: pedir uno (nivel, motivo, caducidad) y
 * cerrarlo. Para entrar, un pase de un solo uso abre el subdominio del
 * negocio con sesión (solo quien abrió el acceso, mientras dure).
 */
export default async function SoportePage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const [actor, { org }, orgs, accesos] = await Promise.all([
    requirePlataformaPagina(),
    searchParams,
    listarOrganizaciones(),
    listarAccesos(),
  ]);
  return (
    <>
      <EncabezadoPagina
        titulo="Soporte"
        descripcion="Sin acceso no ves nada de un negocio. Cada acceso tiene motivo, nivel y caducidad, y el dueño lo ve."
      />
      <GestorSoporte
        orgInicial={orgs.some((o) => o.id === org) ? org : undefined}
        yo={actor.userId}
        maxHoras={MAX_HORAS_SOPORTE}
        organizaciones={orgs.map((o) => ({
          id: o.id,
          name: o.name,
          slug: o.slug,
        }))}
        accesos={accesos}
      />
    </>
  );
}
