import { headers } from "next/headers";
import { esPlataforma } from "@/lib/tenancy";
import { organizacionPorHost } from "@/server/tenant/consultas";

/**
 * 069 (US4, D10, FR-013) — De qué negocio son la marca, la apariencia y la
 * región de una pantalla SIN organización explícita (login, layout raíz,
 * manifest, favicon, icono de la app), en modo plataforma:
 *
 * 1. el host `{slug}.<dominio-base>` de un negocio activo → ese negocio (su
 *    login lleva su marca aunque quien lo abre no tenga sesión);
 * 2. si no, la organización de la sesión (dominio raíz con empresa elegida);
 * 3. si no, ninguna → marca de plataforma Aliantis y región de la instancia.
 *
 * En `single` devuelve null y cada llamador conserva su comportamiento 2.8.0.
 * Nunca «la primera organización».
 */
export async function organizacionParaMarca(): Promise<string | null> {
  if (!esPlataforma()) return null;
  let h: Headers;
  try {
    h = await headers();
  } catch {
    // Fuera de una petición (un script, una prueba): no hay host.
    return null;
  }
  const porHost = await organizacionPorHost(h).catch(() => null);
  if (porHost) return porHost.id;
  try {
    // Import diferido: la sesión importa medio servidor y esto lo usa el
    // módulo de marca, que también se carga sin sesión.
    const { contextoActual } = await import("@/lib/auth/session");
    const ctx = await contextoActual();
    return ctx.kind === "organizacion" ? ctx.organizationId : null;
  } catch {
    return null;
  }
}
