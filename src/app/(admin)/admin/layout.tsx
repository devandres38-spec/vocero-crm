import type { Metadata } from "next";
import { PanelShell } from "@/components/panel/panel-shell";
import { aparienciaActual } from "@/server/apariencia";
import { estadoDelPanel } from "@/server/panel/guard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Panel de Aliantis",
  robots: { index: false, follow: false },
};

/**
 * 076 — El marco del panel. No decide quién entra (lo hace cada página con
 * `paginaDelPanel`): solo pinta la navegación cuando el guard dice «ok». Sin
 * él (la pantalla del segundo factor), la página va sola.
 */
export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const estado = await estadoDelPanel();
  if (estado.tipo !== "ok") return <>{children}</>;
  const { apariencia } = await aparienciaActual(null);
  return (
    <PanelShell nombre={estado.superadmin.nombre} apariencia={apariencia}>
      {children}
    </PanelShell>
  );
}
