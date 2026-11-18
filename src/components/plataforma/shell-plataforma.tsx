"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Building2, KeyRound, LifeBuoy, LogOut, Menu, PlusCircle, ShieldCheck, X, type LucideIcon } from "lucide-react";
import { signOut } from "@/lib/auth/client";
import { ThemeToggle } from "@/components/theme-toggle";
import type { Apariencia } from "@/lib/temas";
import { cn } from "@/lib/utils";

/**
 * Auditoría 069 (Fix-D) — El marco del panel de la agencia: lateral fijo en
 * escritorio, cajón en móvil, ruta activa marcada, tema claro/oscuro y salir.
 * Usa los tokens de Aliantis (nunca la marca de un negocio).
 */

const NAV: { href: string; titulo: string; icono: LucideIcon; activa: (p: string) => boolean }[] = [
  {
    href: "/platform",
    titulo: "Negocios",
    icono: Building2,
    activa: (p) => p === "/platform" || p.startsWith("/platform/organizaciones"),
  },
  { href: "/platform/nuevo", titulo: "Nuevo negocio", icono: PlusCircle, activa: (p) => p.startsWith("/platform/nuevo") },
  { href: "/platform/soporte", titulo: "Soporte", icono: LifeBuoy, activa: (p) => p.startsWith("/platform/soporte") },
  { href: "/platform/auditoria", titulo: "Auditoría", icono: ShieldCheck, activa: (p) => p.startsWith("/platform/auditoria") },
  { href: "/platform/tokens", titulo: "Tokens", icono: KeyRound, activa: (p) => p.startsWith("/platform/tokens") },
];

export function ShellPlataforma({
  logo,
  correo,
  apariencia,
  children,
}: {
  logo: React.ReactNode;
  correo: string;
  apariencia: Apariencia;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "/platform";
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);

  // Al navegar, el cajón se cierra solo.
  useEffect(() => setAbierto(false), [pathname]);

  const lateral = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-4 py-4">
        <Link href="/platform" className="flex min-w-0 items-center gap-2">
          {logo}
          <span className="truncate rounded-md bg-brand-tint px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-ink">
            Plataforma
          </span>
        </Link>
        <button type="button" aria-label="Cerrar menú" className="rounded p-1 text-text-3 hover:text-foreground lg:hidden" onClick={() => setAbierto(false)}>
          <X className="h-5 w-5" />
        </button>
      </div>
      <nav aria-label="Plataforma" className="flex-1 space-y-0.5 px-2">
        {NAV.map((n) => {
          const Icono = n.icono;
          const activa = n.activa(pathname);
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={activa ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                activa ? "bg-brand-tint font-medium text-brand-ink" : "text-text-2 hover:bg-subtle hover:text-foreground"
              )}
            >
              <Icono className="h-4 w-4 shrink-0" strokeWidth={1.8} />
              {n.titulo}
            </Link>
          );
        })}
      </nav>
      <div className="border-t px-3 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-subtle text-xs font-semibold text-text-2">
            {correo.charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium">{correo}</span>
            <span className="block text-[11px] text-text-3">Super-Admin</span>
          </span>
          <ThemeToggle initial={apariencia} />
          <button
            type="button"
            aria-label="Cerrar sesión"
            title="Cerrar sesión"
            className="rounded p-1 text-text-3 hover:text-foreground"
            onClick={async () => {
              await signOut();
              router.push("/login");
              router.refresh();
            }}
          >
            <LogOut className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-subtle">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r bg-background lg:block">{lateral}</aside>

      {abierto && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" aria-label="Cerrar menú" className="absolute inset-0 bg-overlay" onClick={() => setAbierto(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r bg-background shadow-md">{lateral}</aside>
        </div>
      )}

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b bg-background px-3 lg:hidden">
          <button type="button" aria-label="Abrir menú" className="rounded p-1.5 text-text-2 hover:text-foreground" onClick={() => setAbierto(true)}>
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-semibold">Plataforma</span>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}

/** Título de página con subtítulo y acción principal a la derecha. */
export function EncabezadoPagina({
  titulo,
  descripcion,
  accion,
}: {
  titulo: string;
  descripcion?: string;
  accion?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{titulo}</h1>
        {descripcion && <p className="mt-1 text-sm text-text-3">{descripcion}</p>}
      </div>
      {accion}
    </div>
  );
}
