import { EncabezadoPagina } from "@/components/plataforma/shell-plataforma";
import { VisorAuditoria } from "@/components/plataforma/visor-auditoria";
import { ACCIONES_AUDITORIA } from "@/server/platform/auditoria";
import { listarOrganizaciones } from "@/server/platform/organizaciones";

export const dynamic = "force-dynamic";

/**
 * 069 (US5) — El rastro de la plataforma: quién, qué, en qué negocio, por qué
 * vía y cuándo. Auditoría 069 (Fix-D): lo lee `GET /api/platform/audit` con
 * filtros y paginación por cursor; la hora, en la zona del navegador.
 */
export default async function AuditoriaPage() {
  const orgs = await listarOrganizaciones();
  return (
    <>
      <EncabezadoPagina
        titulo="Auditoría"
        descripcion="Toda acción de la plataforma, por panel, API o MCP. Nunca lleva textos de clientes."
      />
      <VisorAuditoria organizaciones={orgs.map((o) => ({ id: o.id, name: o.name }))} acciones={[...ACCIONES_AUDITORIA]} />
    </>
  );
}
