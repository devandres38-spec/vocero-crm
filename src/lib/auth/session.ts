import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { conNegocio } from "@/lib/db/contexto";
import { MENSAJE_NEGOCIO_PAUSADO, resolveMembership } from "@/server/auth/on-signup";

export type SessionContext = {
  userId: string;
  organizationId: string;
  role: string;
};

export class UnauthorizedError extends Error {
  constructor(message = "No autenticado") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * 076 (respuesta 2 de Andres) — El negocio lo pausó Andres: su personal no
 * entra. Es un `UnauthorizedError`: las rutas responden 401 y las páginas
 * mandan al login, que no deja entrar y dice por qué.
 */
export class NegocioPausado extends UnauthorizedError {
  constructor() {
    super(MENSAJE_NEGOCIO_PAUSADO);
    this.name = "NegocioPausado";
  }
}

/**
 * Sesión + organización activa para route handlers y server components.
 * Lanza UnauthorizedError si no hay sesión u organización.
 */
export async function requireSession(): Promise<SessionContext> {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UnauthorizedError();
  // La sesión puede crearse antes de que la membresía exista (registro
  // inicial) — la membresía en BD es la fuente de verdad de org + rol.
  const membership = await resolveMembership(session.user.id);
  if (!membership) {
    throw new UnauthorizedError("Sesión sin organización activa");
  }
  if (membership.pausado) throw new NegocioPausado();
  return {
    userId: session.user.id,
    organizationId: membership.organizationId,
    role: membership.role,
  };
}

/** Igual que requireSession pero devuelve null en vez de lanzar. */
export async function getSessionOrNull(): Promise<SessionContext | null> {
  try {
    return await requireSession();
  } catch {
    return null;
  }
}

/**
 * 075 — Una página o un layout del servidor, dentro del negocio de la sesión
 * (RLS). Sin sesión, corre sin negocio: la página redirige al login, y lo que
 * no tenga sesión (la marca del login) no consulta la base.
 */
export function paginaConSesion<A extends unknown[], R>(
  pagina: (...props: A) => Promise<R>
): (...props: A) => Promise<R> {
  return async (...props: A) => {
    const session = await getSessionOrNull();
    if (!session) return pagina(...props);
    return conNegocio(session.organizationId, () => pagina(...props));
  };
}
