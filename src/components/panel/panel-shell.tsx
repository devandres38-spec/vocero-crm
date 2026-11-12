"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, LayoutDashboard, LogOut, ScrollText, ShieldCheck, UserRound } from "lucide-react";
import { BrandTile } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { DEFAULT_BRANDING } from "@/lib/branding";
import type { Apariencia } from "@/lib/temas";
import { cn } from "@/lib/utils";

/**
 * 076 (D16) — El marco del panel de Andres. Navegación propia: sin Bandeja,
 * Contactos, Pipeline ni Citas, sin eventos en vivo ni avisos de mensajes.
 * Escritorio: barra lateral. Celular: barra de arriba y pestañas abajo.
 * Marca por defecto (la de Vocero) hasta que Andres dé la de Aliantis.
 */
const SECCIONES = [
  { href: "/admin", etiqueta: "Resumen", icono: LayoutDashboard, exacta: true },
  { href: "/admin/negocios", etiqueta: "Negocios", icono: Building2, exacta: false },
  { href: "/admin/registro", etiqueta: "Registro", icono: ScrollText, exacta: false },
  { href: "/admin/cuenta", etiqueta: "Mi cuenta", icono: UserRound, exacta: false },
] as const;

function activa(pathname: string, href: string, exacta: boolean) {
  return exacta ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function PanelShell({
  nombre,
  apariencia,
  children,
}: {
  nombre: string;
  apariencia: Apariencia;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "/admin";
  return (
    <div className="flex min-h-screen bg-subtle text-foreground">
      {/* Escritorio */}
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-card px-3 py-4 lg:flex">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <BrandTile branding={DEFAULT_BRANDING} className="size-8" />
          <div className="leading-tight">
            <p className="text-[13.5px] font-bold">Aliantis</p>
            <p className="text-xs text-text-3">Panel de administración</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5" aria-label="Panel">
          {SECCIONES.map(({ href, etiqueta, icono: Icono, exacta }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 rounded-sm px-2.5 py-2 text-[13.5px] font-semibold transition-colors",
                activa(pathname, href, exacta)
                  ? "bg-brand-tint text-brand-text"
                  : "text-text-2 hover:bg-accent hover:text-foreground"
              )}
            >
              <Icono className="size-4" aria-hidden />
              {etiqueta}
            </Link>
          ))}
        </nav>
        <div className="mt-4 border-t pt-3">
          <div className="flex items-center gap-2 px-2 pb-2 text-xs text-text-3">
            <ShieldCheck className="size-3.5" aria-hidden />
            <span className="truncate">{nombre}</span>
          </div>
          <div className="flex items-center justify-between px-1">
            <ThemeToggle initial={apariencia} />
            <a
              href="/api/admin/salir"
              className="flex items-center gap-1.5 rounded-sm px-2 py-1.5 text-[13px] font-semibold text-text-2 hover:bg-accent"
            >
              <LogOut className="size-4" aria-hidden />
              Salir
            </a>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Celular: arriba */}
        <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-card px-4 py-2.5 lg:hidden">
          <div className="flex items-center gap-2">
            <BrandTile branding={DEFAULT_BRANDING} className="size-8" />
            <p className="text-sm font-bold">Aliantis · Panel</p>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle initial={apariencia} />
            <a
              href="/api/admin/salir"
              className="flex min-h-11 min-w-11 items-center justify-center rounded-sm text-text-2"
              aria-label="Salir"
            >
              <LogOut className="size-5" aria-hidden />
            </a>
          </div>
        </header>

        <main className="flex-1 px-4 pb-24 pt-4 sm:px-6 lg:pb-8 lg:pt-6">{children}</main>

        {/* Celular: pestañas abajo */}
        <nav
          className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
          aria-label="Panel"
        >
          {SECCIONES.map(({ href, etiqueta, icono: Icono, exacta }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold",
                activa(pathname, href, exacta) ? "text-brand-ink" : "text-text-3"
              )}
            >
              <Icono className="size-5" aria-hidden />
              {etiqueta}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
