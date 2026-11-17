import type { Tenancy } from "@/lib/tenancy";
import {
  modulosEfectivos,
  type ModulosEfectivos,
  type TechoInstancia,
} from "@/server/modulos/efectivos";
import { slugDelHost } from "@/server/tenant/host";

/**
 * 069 (D4) — EL resolvedor de organización. Toda petición con sesión pasa por
 * aquí (vía `requireSession`); nada más decide de qué negocio es una petición.
 *
 * Orden (FR-010, modo `multi`):
 *   1. host `{slug}.<dominio-base>` → la organización debe existir y el
 *      usuario ser miembro (o tener acceso de soporte vigente);
 *   2. dominio raíz → `session.activeOrganizationId`, validada contra la
 *      membresía;
 *   3. nada → plataforma (Super-Admin) o «sin organización».
 * Nunca «la primera organización».
 *
 * En `single` devuelve lo de la 2.8.0: la membresía del usuario (en `single`
 * hay una sola organización) con los módulos del techo de la instancia.
 *
 * Puro: las consultas llegan inyectadas, para probarlo sin base de datos.
 */

export type OrgFila = {
  id: string;
  slug: string | null;
  status: "activa" | "suspendida";
  modules: unknown;
};

export type GrantSoporte = {
  id: string;
  level: "lectura" | "configuracion";
  expiresAt: Date;
};

export type Contexto =
  | { kind: "anonimo" }
  | {
      kind: "organizacion";
      userId: string;
      organizationId: string;
      role: string;
      via: "miembro" | "soporte";
      grant?: GrantSoporte;
      modulos: ModulosEfectivos;
    }
  | { kind: "suspendida"; userId: string; organizationId: string }
  | { kind: "plataforma"; userId: string }
  | {
      kind: "ninguno";
      userId: string;
      motivo: "no_miembro" | "org_inexistente" | "sin_organizacion";
      /** Super-Admin sin acceso en el host de una organización (se audita). */
      organizationId?: string;
    };

export type DepsContexto = {
  modo: Tenancy;
  base: string | null;
  host: string | null;
  sesion: () => Promise<{ userId: string; activeOrganizationId: string | null } | null>;
  techo: () => TechoInstancia;
  /** Solo `single`. */
  membresiaUnicaInstancia: (userId: string) => Promise<{ organizationId: string; role: string } | null>;
  orgPorSlug: (slug: string) => Promise<OrgFila | null>;
  orgPorId: (id: string) => Promise<OrgFila | null>;
  membresia: (userId: string, organizationId: string) => Promise<{ role: string } | null>;
  esSuperAdmin: (userId: string) => Promise<boolean>;
  grantVigente: (userId: string, organizationId: string) => Promise<GrantSoporte | null>;
};

export async function resolverContexto(d: DepsContexto): Promise<Contexto> {
  const sesion = await d.sesion();
  if (!sesion) return { kind: "anonimo" };
  const { userId } = sesion;

  if (d.modo === "single") {
    // La sesión puede crearse antes que la membresía (registro inicial): la
    // membresía en BD es la fuente de verdad de org + rol.
    const m = await d.membresiaUnicaInstancia(userId);
    if (!m) return { kind: "ninguno", userId, motivo: "sin_organizacion" };
    return {
      kind: "organizacion",
      userId,
      organizationId: m.organizationId,
      role: m.role,
      via: "miembro",
      modulos: modulosEfectivos(d.techo(), null),
    };
  }

  const host = slugDelHost(d.host, d.base);
  if (host.tipo === "organizacion") {
    const org = await d.orgPorSlug(host.slug);
    if (!org) return { kind: "ninguno", userId, motivo: "org_inexistente" };
    return deOrganizacion(d, userId, org);
  }

  // Dominio raíz: la organización activa de la sesión, validada.
  if (sesion.activeOrganizationId) {
    const org = await d.orgPorId(sesion.activeOrganizationId);
    if (org) {
      const r = await deOrganizacion(d, userId, org, { soporte: false });
      if (r.kind !== "ninguno") return r;
    }
  }
  if (await d.esSuperAdmin(userId)) return { kind: "plataforma", userId };
  return { kind: "ninguno", userId, motivo: "sin_organizacion" };
}

async function deOrganizacion(
  d: DepsContexto,
  userId: string,
  org: OrgFila,
  opciones: { soporte: boolean } = { soporte: true }
): Promise<Contexto> {
  const m = await d.membresia(userId, org.id);
  if (m) {
    // Un Super-Admin que además es miembro actúa como miembro.
    if (org.status === "suspendida") {
      return { kind: "suspendida", userId, organizationId: org.id };
    }
    return {
      kind: "organizacion",
      userId,
      organizationId: org.id,
      role: m.role,
      via: "miembro",
      modulos: modulosEfectivos(d.techo(), org.modules),
    };
  }
  // El soporte solo entra por el host del negocio: un acceso es a UNA
  // organización y se nota en la URL.
  if (opciones.soporte && (await d.esSuperAdmin(userId))) {
    const grant = await d.grantVigente(userId, org.id);
    if (grant) {
      return {
        kind: "organizacion",
        userId,
        organizationId: org.id,
        role: "soporte",
        via: "soporte",
        grant,
        modulos: modulosEfectivos(d.techo(), org.modules),
      };
    }
    return { kind: "ninguno", userId, motivo: "no_miembro", organizationId: org.id };
  }
  return { kind: "ninguno", userId, motivo: "no_miembro" };
}
