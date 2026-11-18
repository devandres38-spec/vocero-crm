import { count, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { correosSuperAdmin, esPlataforma, normalizarCorreo } from "@/lib/tenancy";
import { auditar } from "@/server/platform/auditoria";

/** Etapas sembradas del pipeline (US2). */
const SEED_STAGES: { name: string; kind: "open" | "won" | "lost" }[] = [
  { name: "Nuevo", kind: "open" },
  { name: "En conversación", kind: "open" },
  { name: "Interesado", kind: "open" },
  { name: "Cliente", kind: "won" },
  { name: "Perdido", kind: "lost" },
];

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * Lo que toda organización nueva trae: pipeline y perfil del agente. Una sola
 * siembra para el alta de `single` y para la de la plataforma (069).
 */
export async function sembrarOrganizacion(tx: Tx, orgId: string): Promise<void> {
  await tx.insert(schema.pipelineStage).values(
    SEED_STAGES.map((s, i) => ({
      id: newId("stage"),
      organizationId: orgId,
      name: s.name,
      position: i,
      kind: s.kind,
    }))
  );
  await tx.insert(schema.agentProfile).values({
    id: newId("agentProfile"),
    organizationId: orgId,
  });
}

/**
 * Al crearse un usuario.
 *
 * `single` — Primer registro de la instancia: crea la organización, deja al
 * usuario como propietario y siembra pipeline + perfil del agente. Solo actúa
 * si NO existe ninguna organización (las cuentas de equipo las crea el
 * propietario y reciben su membresía explícita). Un advisory lock evita que
 * dos registros simultáneos en instancia vacía creen dos organizaciones.
 *
 * `multi` (069) — Nunca crea organizaciones (las da de alta la plataforma).
 * Si el correo es de PLATFORM_ADMIN_EMAILS, el usuario queda Super-Admin.
 */
export async function onUserCreated(userId: string, userName: string, email?: string) {
  const db = getDb();
  if (esPlataforma()) {
    await promoverSuperAdmin(userId, email, "registro");
    return;
  }
  await db.transaction(async (tx) => {
    // Lock transaccional de "primer arranque" (clave arbitraria fija):
    // dos registros simultáneos en instancia vacía → solo uno crea la org.
    await tx.execute(sql`select pg_advisory_xact_lock(874201)`);
    const [orgs] = await tx
      .select({ n: count() })
      .from(schema.organization);
    if ((orgs?.n ?? 0) > 0) return;

    const orgId = newId("organization");
    await tx.insert(schema.organization).values({
      id: orgId,
      name: userName ? `Negocio de ${userName}` : "Mi negocio",
      slug: "principal",
    });
    await tx.insert(schema.member).values({
      id: newId("member"),
      organizationId: orgId,
      userId,
      role: "owner",
    });
    await sembrarOrganizacion(tx, orgId);
  });
}

/**
 * 069 — Deja Super-Admin a quien tenga su correo en PLATFORM_ADMIN_EMAILS.
 * Idempotente: solo inserta y audita la primera vez. Corre al registrarse y
 * —H-03— al iniciar sesión, para que una instancia que pasa de `single` a
 * `multi` no deje fuera al dueño que ya tenía cuenta. Quitar un correo de la
 * lista NO degrada a nadie: eso se hace a propósito, no por un deploy.
 */
export async function promoverSuperAdmin(
  userId: string,
  email: string | undefined,
  origen: "registro" | "inicio_de_sesion"
): Promise<boolean> {
  if (!esPlataforma() || !email || !correosSuperAdmin().has(normalizarCorreo(email))) {
    return false;
  }
  return getDb().transaction(async (tx) => {
    const nuevos = await tx
      .insert(schema.platformAdmin)
      .values({ userId, createdBy: "PLATFORM_ADMIN_EMAILS" })
      .onConflictDoNothing()
      .returning({ userId: schema.platformAdmin.userId });
    if (nuevos.length === 0) return false;
    await auditar({ actorUserId: userId, action: "admin_registrado", detail: { origen } }, tx);
    return true;
  });
}

/** H-03 — Al crear una sesión en `multi`: promover si el correo está en la lista. */
export async function sincronizarSuperAdmin(userId: string): Promise<void> {
  if (!esPlataforma() || correosSuperAdmin().size === 0) return;
  const [u] = await getDb()
    .select({ email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);
  await promoverSuperAdmin(userId, u?.email, "inicio_de_sesion");
}

/**
 * Organización activa al crear una sesión.
 *
 * `single`: su membresía (en `single` hay una sola organización).
 * `multi` (069): la ÚNICA si tiene exactamente una; con varias, ninguna —el
 * host o el selector deciden—. Nunca «la primera».
 */
export async function resolveActiveOrganizationId(
  userId: string
): Promise<string | null> {
  if (esPlataforma()) {
    const rows = await getDb()
      .select({ organizationId: schema.member.organizationId })
      .from(schema.member)
      .where(eq(schema.member.userId, userId))
      .limit(2);
    return rows.length === 1 ? rows[0]!.organizationId : null;
  }
  return (await resolveMembership(userId))?.organizationId ?? null;
}

/**
 * Solo modo `single` (069): la membresía del usuario en la organización de la
 * instancia. En `multi` la organización la decide `resolverContexto`.
 */
export async function resolveMembership(
  userId: string
): Promise<{ organizationId: string; role: string } | null> {
  const db = getDb();
  const rows = await db
    .select({
      organizationId: schema.member.organizationId,
      role: schema.member.role,
    })
    .from(schema.member)
    .where(eq(schema.member.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}
