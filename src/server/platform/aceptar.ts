import { and, eq } from "drizzle-orm";
import { getAuth, runInternalSignup } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { normalizarCorreo } from "@/lib/tenancy";
import { auditar } from "@/server/platform/auditoria";
import { hashToken } from "@/server/platform/invitaciones";

/**
 * 069 (US3, D6) — Aceptar una invitación.
 *
 * - Correo SIN cuenta: se crea (bypass interno del registro cerrado) con el
 *   nombre y la contraseña que pone la persona.
 * - Correo CON cuenta: debe tener la sesión iniciada con ESE correo; su
 *   contraseña no se toca.
 * El paso que importa —membresía + invitación usada— va en UNA transacción
 * con la fila de la invitación bloqueada: dos clics simultáneos no generan
 * dos membresías y el enlace sirve una sola vez.
 */

export type EstadoInvitacion =
  | "vigente"
  | "vencida"
  | "usada"
  | "revocada"
  | "inexistente";

export type InvitacionPublica = {
  estado: EstadoInvitacion;
  /** Solo si existe: para mostrar a qué negocio te invitan. */
  organizacion?: { id: string; name: string; slug: string | null };
  email?: string;
  role?: string;
  /** ¿Ya hay una cuenta con ese correo? (decide formulario o login) */
  cuentaExiste?: boolean;
};

function estadoDe(fila: { status: string; expiresAt: Date }, ahora: Date): EstadoInvitacion {
  if (fila.status === "accepted") return "usada";
  if (fila.status !== "pending") return "revocada";
  if (fila.expiresAt <= ahora) return "vencida";
  return "vigente";
}

async function usuarioPorCorreo(email: string): Promise<{ id: string } | null> {
  const rows = await getDb()
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, normalizarCorreo(email)))
    .limit(1);
  return rows[0] ?? null;
}

/** Lo que la página puede contar de un enlace (nada si no existe). */
export async function leerInvitacion(token: string, ahora: Date = new Date()): Promise<InvitacionPublica> {
  if (!token || token.length > 200) return { estado: "inexistente" };
  const rows = await getDb()
    .select({
      status: schema.invitation.status,
      expiresAt: schema.invitation.expiresAt,
      email: schema.invitation.email,
      role: schema.invitation.role,
      orgId: schema.organization.id,
      orgName: schema.organization.name,
      orgSlug: schema.organization.slug,
    })
    .from(schema.invitation)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.invitation.organizationId))
    .where(eq(schema.invitation.tokenHash, hashToken(token)))
    .limit(1);
  const fila = rows[0];
  if (!fila) return { estado: "inexistente" };
  const estado = estadoDe(fila, ahora);
  return {
    estado,
    organizacion: { id: fila.orgId, name: fila.orgName, slug: fila.orgSlug },
    email: fila.email,
    role: fila.role ?? "member",
    cuentaExiste: estado === "vigente" ? (await usuarioPorCorreo(fila.email)) !== null : undefined,
  };
}

export class AceptarError extends Error {
  constructor(
    public code:
      | "invitacion_inexistente"
      | "invitacion_vencida"
      | "invitacion_usada"
      | "invitacion_revocada"
      | "otro_correo"
      | "inicia_sesion"
      | "datos_requeridos"
      | "registro_fallido",
    public status: number
  ) {
    super(code);
    this.name = "AceptarError";
  }
}

const ERROR_POR_ESTADO: Record<Exclude<EstadoInvitacion, "vigente">, AceptarError> = {
  inexistente: new AceptarError("invitacion_inexistente", 404),
  vencida: new AceptarError("invitacion_vencida", 410),
  usada: new AceptarError("invitacion_usada", 410),
  revocada: new AceptarError("invitacion_revocada", 410),
};

export async function aceptarInvitacion(input: {
  token: string;
  /** Usuario de la sesión actual, si la hay. */
  sesion: { userId: string; email: string } | null;
  /** Para crear la cuenta si el correo no tiene una. */
  nueva?: { name: string; password: string };
  ip?: string | null;
  ahora?: Date;
}): Promise<{ organizationId: string; slug: string | null; userId: string; cuentaCreada: boolean }> {
  const ahora = input.ahora ?? new Date();
  const info = await leerInvitacion(input.token, ahora);
  if (info.estado !== "vigente") throw ERROR_POR_ESTADO[info.estado];
  const email = normalizarCorreo(info.email!);

  // ¿Quién acepta?
  let userId: string;
  let cuentaCreada = false;
  if (input.sesion) {
    if (normalizarCorreo(input.sesion.email) !== email) throw new AceptarError("otro_correo", 403);
    userId = input.sesion.userId;
  } else if (info.cuentaExiste) {
    throw new AceptarError("inicia_sesion", 409);
  } else {
    if (!input.nueva) throw new AceptarError("datos_requeridos", 422);
    try {
      const r = await runInternalSignup(() =>
        getAuth().api.signUpEmail({
          body: { name: input.nueva!.name, email, password: input.nueva!.password },
        })
      );
      userId = r.user.id;
      cuentaCreada = true;
    } catch {
      throw new AceptarError("registro_fallido", 422);
    }
  }

  const hash = hashToken(input.token);
  return getDb().transaction(async (tx) => {
    const [fila] = await tx
      .select({
        id: schema.invitation.id,
        organizationId: schema.invitation.organizationId,
        status: schema.invitation.status,
        expiresAt: schema.invitation.expiresAt,
        role: schema.invitation.role,
        email: schema.invitation.email,
      })
      .from(schema.invitation)
      .where(eq(schema.invitation.tokenHash, hash))
      .for("update")
      .limit(1);
    if (!fila) throw ERROR_POR_ESTADO.inexistente;
    const estado = estadoDe(fila, ahora);
    if (estado !== "vigente") throw ERROR_POR_ESTADO[estado];
    if (normalizarCorreo(fila.email) !== email) throw new AceptarError("otro_correo", 403);

    const ya = await tx
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(and(eq(schema.member.organizationId, fila.organizationId), eq(schema.member.userId, userId)))
      .limit(1);
    if (ya.length === 0) {
      await tx.insert(schema.member).values({
        id: newId("member"),
        organizationId: fila.organizationId,
        userId,
        role: fila.role ?? "member",
      });
    }
    await tx
      .update(schema.invitation)
      .set({ status: "accepted", acceptedAt: ahora })
      .where(eq(schema.invitation.id, fila.id));
    await auditar(
      {
        actorUserId: userId,
        action: "invitacion_aceptada",
        organizationId: fila.organizationId,
        ip: input.ip,
        detail: { invitationId: fila.id, role: fila.role ?? "member", cuentaCreada },
      },
      tx
    );
    return {
      organizationId: fila.organizationId,
      slug: info.organizacion?.slug ?? null,
      userId,
      cuentaCreada,
    };
  });
}
