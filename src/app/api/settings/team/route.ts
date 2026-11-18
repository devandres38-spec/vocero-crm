import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getAuth, runInternalSignup } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { clientIp } from "@/lib/rate-limit";
import { esPlataforma } from "@/lib/tenancy";
import { crearInvitacion, esMiembroPorCorreo } from "@/server/platform/invitaciones";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const db = getDb();
  const members = await db
    .select({
      id: schema.member.id,
      role: schema.member.role,
      createdAt: schema.member.createdAt,
      name: schema.user.name,
      email: schema.user.email,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
    .where(scoped(schema.member.organizationId, session.organizationId));
  return Response.json({
    members: members.map((m) => ({
      id: m.id,
      role: m.role,
      name: m.name,
      email: m.email,
      createdAt: m.createdAt.toISOString(),
    })),
  });
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
});

/** Alta de cuenta de equipo (owner only): email + contraseña temporal (FR-061). */
export const POST = withAuth(async (session, req: Request) => {
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede crear cuentas");
  }
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;

  const auth = getAuth();
  let newUserId: string;
  try {
    const result = await runInternalSignup(() =>
      auth.api.signUpEmail({
        body: {
          name: body.data.name,
          email: body.data.email,
          password: body.data.password,
        },
      })
    );
    newUserId = result.user.id;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "No se pudo crear la cuenta";
    if (/exist/i.test(message)) {
      // 069 (US3-6) — En modo plataforma la cuenta puede ser de OTRO negocio:
      // no se le da la membresía sin que la acepte. Se genera una invitación
      // de equipo y el owner le pasa el enlace.
      if (esPlataforma()) return invitarCuentaExistente(session, body.data.email, req);
      return apiError(409, "duplicate", "Ya existe una cuenta con ese correo");
    }
    return apiError(422, "invalid", message);
  }

  const db = getDb();
  await db
    .insert(schema.member)
    .values({
      id: newId("member"),
      organizationId: session.organizationId,
      userId: newUserId,
      role: "member",
    })
    .onConflictDoNothing();

  return Response.json({ ok: true }, { status: 201 });
});

async function invitarCuentaExistente(
  session: { userId: string; organizationId: string },
  email: string,
  req: Request
): Promise<Response> {
  const db = getDb();
  const [org] = await db
    .select({ slug: schema.organization.slug })
    .from(schema.organization)
    .where(eq(schema.organization.id, session.organizationId))
    .limit(1);
  const r = await db.transaction(async (tx) => {
    if (await esMiembroPorCorreo(tx, session.organizationId, email)) return null;
    return crearInvitacion(
      tx,
      { userId: session.userId, via: "sesion", ip: clientIp(req.headers) },
      { organizationId: session.organizationId, slug: org?.slug ?? null, email, role: "member" }
    );
  });
  if (!r) return apiError(409, "duplicate", "Esa persona ya está en tu equipo");
  return Response.json(
    { ok: true, invitation: { url: r.url, expiresAt: r.expiresAt.toISOString() } },
    { status: 202 }
  );
}
