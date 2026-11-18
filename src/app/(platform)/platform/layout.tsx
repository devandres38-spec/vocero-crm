import { headers } from "next/headers";
import { DEFAULT_BRANDING } from "@/lib/branding";
import { getAuth } from "@/lib/auth";
import { BrandLogo } from "@/components/brand-mark";
import { ShellPlataforma } from "@/components/plataforma/shell-plataforma";
import { aparienciaActual } from "@/server/apariencia";
import { requirePlataformaPagina } from "@/server/platform/guardia";

export const dynamic = "force-dynamic";

/**
 * 069 (US2) — El panel de la agencia. Existe solo en modo plataforma y solo
 * para Super-Admins: para cualquier otro es un 404 (no se anuncia). Lleva la
 * marca de plataforma, nunca la de un negocio. Auditoría 069 (Fix-D):
 * lateral fijo, cajón en móvil, ruta activa, tema y salir.
 */
export default async function PlatformLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requirePlataformaPagina();
  const [s, { apariencia }] = await Promise.all([
    getAuth().api.getSession({ headers: await headers() }),
    aparienciaActual(null),
  ]);
  return (
    <ShellPlataforma
      logo={<BrandLogo branding={DEFAULT_BRANDING} size="md" />}
      correo={s?.user.email ?? ""}
      apariencia={apariencia}
    >
      {children}
    </ShellPlataforma>
  );
}
