import Link from "next/link";
import { DEFAULT_BRANDING } from "@/lib/branding";
import { BrandLogo } from "@/components/brand-mark";
import { BotonSalir } from "@/components/plataforma/boton-salir";
import { requirePlataformaPagina } from "@/server/platform/guardia";

export const dynamic = "force-dynamic";

/**
 * 069 (US2) — El panel de la agencia. Existe solo en modo plataforma y solo
 * para Super-Admins: para cualquier otro es un 404 (no se anuncia). Lleva la
 * marca de plataforma, nunca la de un negocio.
 */
export default async function PlatformLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requirePlataformaPagina();
  return (
    <div className="min-h-screen bg-subtle">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/platform" className="flex items-center gap-3">
            <BrandLogo branding={DEFAULT_BRANDING} size="md" />
            <span className="text-sm text-text-3">Plataforma</span>
          </Link>
          <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <Link href="/platform" className="text-text-2 hover:text-foreground">
              Negocios
            </Link>
            <Link href="/platform/nuevo" className="text-text-2 hover:text-foreground">
              Nuevo negocio
            </Link>
            <Link href="/platform/soporte" className="text-text-2 hover:text-foreground">
              Soporte
            </Link>
            <Link href="/platform/auditoria" className="text-text-2 hover:text-foreground">
              Auditoría
            </Link>
            <Link href="/platform/tokens" className="text-text-2 hover:text-foreground">
              Tokens
            </Link>
            <BotonSalir />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
