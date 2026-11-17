import { cache } from "react";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { esPlataforma as tenancyEsMulti } from "@/lib/tenancy";
import type { ModulosEfectivos } from "@/server/modulos/efectivos";
import { resolverContexto, type Contexto, type GrantSoporte } from "@/server/tenant/contexto";
import { depsReales } from "@/server/tenant/consultas";

export type SessionContext = {
  userId: string;
  organizationId: string;
  role: string;
  /** 069 — Cómo entró: como miembro o por un acceso de soporte. */
  via?: "miembro" | "soporte";
  grant?: GrantSoporte;
  /**
   * 069 — Módulos efectivos de la organización (techo ∧ organización). Si
   * falta (contextos armados a mano en pruebas), se usa el techo.
   */
  modulos?: ModulosEfectivos;
};

export class UnauthorizedError extends Error {
  constructor(message = "No autenticado") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/** 069 — La organización existe y el usuario es miembro, pero está suspendida. */
export class OrganizacionSuspendidaError extends Error {
  constructor() {
    super("Organización suspendida");
    this.name = "OrganizacionSuspendidaError";
  }
}

/**
 * 069 — El contexto completo de la petición (D4): de qué organización es, o
 * por qué no es de ninguna. Una vez por petición en server components.
 */
export const contextoActual = cache(async (): Promise<Contexto> => {
  const h = await headers();
  return resolverContexto(
    depsReales(h, async () => {
      const s = await getAuth().api.getSession({ headers: h });
      return s
        ? { userId: s.user.id, activeOrganizationId: s.session.activeOrganizationId ?? null }
        : null;
    })
  );
});

/**
 * Sesión + organización de la petición para route handlers y server
 * components. Lanza UnauthorizedError si no hay sesión u organización, y
 * OrganizacionSuspendidaError si su organización está suspendida.
 */
export async function requireSession(): Promise<SessionContext> {
  const ctx = await contextoActual();
  switch (ctx.kind) {
    case "organizacion":
      return {
        userId: ctx.userId,
        organizationId: ctx.organizationId,
        role: ctx.role,
        via: ctx.via,
        grant: ctx.grant,
        modulos: ctx.modulos,
      };
    case "suspendida":
      throw new OrganizacionSuspendidaError();
    case "anonimo":
      throw new UnauthorizedError();
    default:
      throw new UnauthorizedError("Sesión sin organización activa");
  }
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
 * 069 — A dónde mandar a quien no tiene organización en esta petición. En
 * `single` todo va al login, como siempre; en `multi` cada caso tiene su
 * pantalla.
 */
export function destinoSinOrganizacion(ctx: Contexto): string {
  switch (ctx.kind) {
    case "plataforma":
      return "/platform";
    case "suspendida":
      return "/suspendida";
    case "ninguno":
      return tenancyEsMulti() ? "/sin-acceso" : "/login";
    default:
      return "/login";
  }
}
