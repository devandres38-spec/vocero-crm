import { z } from "zod";
import { getDb } from "@/lib/db";
import { buscarOrganizacion } from "@/server/platform/blueprint/aplicar";
import { requirePlataforma } from "@/server/platform/guardia";
import { errorPlataforma, leerJson, respuestaDeError } from "@/server/platform/http";
import { crearInvitacion, esMiembroPorCorreo } from "@/server/platform/invitaciones";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ idOrSlug: string }> };

const schema = z
  .object({
    email: z
      .string()
      .transform((v) => v.trim().toLowerCase())
      .pipe(z.email()),
    role: z.enum(["owner", "admin", "member"]).default("owner"),
  })
  .strict();

/**
 * 069 — Emite un enlace de invitación (se muestra UNA vez). Revoca cualquier
 * pendiente del mismo correo: solo vale el último enlace.
 */
export async function POST(req: Request, ctx: Params): Promise<Response> {
  const g = await requirePlataforma(req, { scope: "provision" });
  if (!g.ok) return g.response;
  const body = await leerJson(req);
  if (!body.ok) return body.response;
  const parsed = schema.safeParse(body.data);
  if (!parsed.success) {
    return errorPlataforma(
      422,
      "invalid_body",
      "Datos inválidos",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }))
    );
  }
  try {
    const org = await buscarOrganizacion((await ctx.params).idOrSlug);
    if (!org) return errorPlataforma(404, "organizacion_inexistente");
    const r = await getDb().transaction(async (tx) => {
      if (await esMiembroPorCorreo(tx, org.id, parsed.data.email)) return null;
      return crearInvitacion(tx, g.actor, {
        organizationId: org.id,
        slug: org.slug,
        email: parsed.data.email,
        role: parsed.data.role,
      });
    });
    if (!r) return errorPlataforma(409, "ya_miembro", "Ese correo ya es miembro de la organización");
    return Response.json(
      { invitationId: r.id, url: r.url, expiresAt: r.expiresAt.toISOString() },
      { status: 201 }
    );
  } catch (err) {
    return respuestaDeError(err);
  }
}
