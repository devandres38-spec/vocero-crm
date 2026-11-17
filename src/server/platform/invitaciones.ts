import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { getEnv } from "@/lib/env";
import { normalizarCorreo, raizPlataforma, urlDeNegocio } from "@/lib/tenancy";
import { auditar } from "@/server/platform/auditoria";

/**
 * 069 (D6, FR-008) — Invitaciones a una organización, sobre la tabla
 * `invitation` de Better Auth. El token del enlace es aleatorio (32 bytes),
 * se muestra UNA vez y en la base solo queda su SHA-256: quien lea la base no
 * puede usar una invitación pendiente. Vence a los 7 días y sirve una vez.
 * No se envían correos (constitución II): el enlace se copia.
 */

export const VIGENCIA_INVITACION_MS = 7 * 24 * 60 * 60 * 1000;

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Conexion = Db | Tx;

export function generarToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * El enlace en el subdominio del negocio (ahí se ve su marca). Sin dominio
 * base configurado, en la URL de la instancia.
 */
export function urlInvitacion(slug: string | null, token: string): string {
  const raiz = raizPlataforma();
  if (raiz && slug) return urlDeNegocio(raiz, slug, `/invitacion/${token}`);
  return `${getEnv().APP_BASE_URL.replace(/\/+$/, "")}/invitacion/${token}`;
}

export type InvitacionVigente = { id: string; expiresAt: Date };

/** La invitación pendiente y vigente de ese correo en esa organización. */
export async function invitacionPendiente(
  db: Conexion,
  organizationId: string,
  email: string,
  ahora: Date = new Date()
): Promise<InvitacionVigente | null> {
  const rows = await db
    .select({ id: schema.invitation.id, expiresAt: schema.invitation.expiresAt })
    .from(schema.invitation)
    .where(
      and(
        eq(schema.invitation.organizationId, organizationId),
        eq(schema.invitation.email, normalizarCorreo(email)),
        eq(schema.invitation.status, "pending"),
        gt(schema.invitation.expiresAt, ahora)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/** ¿Ese correo ya es miembro de la organización? */
export async function esMiembroPorCorreo(
  db: Conexion,
  organizationId: string,
  email: string
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(
      and(eq(schema.member.organizationId, organizationId), eq(schema.user.email, normalizarCorreo(email)))
    )
    .limit(1);
  return rows.length > 0;
}

export type Actor = { userId: string; via: "sesion" | "api" | "mcp"; tokenId?: string | null; ip?: string | null };

/**
 * Crea la invitación y devuelve el enlace (la ÚNICA vez que existe en
 * claro). Revoca antes cualquier pendiente del mismo correo en la misma
 * organización: solo vale el último enlace.
 */
export async function crearInvitacion(
  db: Conexion,
  actor: Actor,
  input: { organizationId: string; slug: string | null; email: string; role: "owner" | "admin" | "member" },
  ahora: Date = new Date()
): Promise<{ id: string; url: string; expiresAt: Date }> {
  const email = normalizarCorreo(input.email);
  await db
    .update(schema.invitation)
    .set({ status: "canceled" })
    .where(
      and(
        eq(schema.invitation.organizationId, input.organizationId),
        eq(schema.invitation.email, email),
        eq(schema.invitation.status, "pending")
      )
    );
  const token = generarToken();
  const id = newId("invitation");
  const expiresAt = new Date(ahora.getTime() + VIGENCIA_INVITACION_MS);
  await db.insert(schema.invitation).values({
    id,
    organizationId: input.organizationId,
    email,
    role: input.role,
    status: "pending",
    expiresAt,
    inviterId: actor.userId,
    tokenHash: hashToken(token),
  });
  await auditar(
    {
      actorUserId: actor.userId,
      action: "invitacion_creada",
      organizationId: input.organizationId,
      via: actor.via,
      tokenId: actor.tokenId,
      ip: actor.ip,
      // El correo identifica a quién se dio acceso: es justo lo auditable.
      detail: { invitationId: id, email, role: input.role },
    },
    db
  );
  return { id, url: urlInvitacion(input.slug, token), expiresAt };
}

/** Revoca una invitación pendiente de esa organización. */
export async function revocarInvitacion(
  actor: Actor,
  organizationId: string,
  invitationId: string
): Promise<boolean> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(schema.invitation)
      .set({ status: "canceled" })
      .where(
        and(
          eq(schema.invitation.id, invitationId),
          eq(schema.invitation.organizationId, organizationId),
          eq(schema.invitation.status, "pending")
        )
      )
      .returning({ id: schema.invitation.id });
    if (rows.length === 0) return false;
    await auditar(
      {
        actorUserId: actor.userId,
        action: "invitacion_revocada",
        organizationId,
        via: actor.via,
        tokenId: actor.tokenId,
        ip: actor.ip,
        detail: { invitationId },
      },
      tx
    );
    return true;
  });
}

/**
 * 069 — Invitar a una organización desde la plataforma (REST y MCP usan esto
 * mismo). `null` si el correo ya es miembro.
 */
export async function invitarAOrganizacion(
  actor: Actor,
  org: { id: string; slug: string | null },
  email: string,
  role: "owner" | "admin" | "member" = "owner"
): Promise<{ id: string; url: string; expiresAt: Date } | null> {
  return getDb().transaction(async (tx) => {
    if (await esMiembroPorCorreo(tx, org.id, email)) return null;
    return crearInvitacion(tx, actor, { organizationId: org.id, slug: org.slug, email, role });
  });
}
