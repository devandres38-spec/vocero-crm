import { z } from "zod";
import { requirePlataforma } from "@/server/platform/guardia";
import { errorPlataforma, leerJson } from "@/server/platform/http";
import { crearToken, listarTokens } from "@/server/platform/tokens";

export const dynamic = "force-dynamic";

/** 069 (D14) — Los tokens propios. Solo con sesión: un token no gestiona tokens. */
export async function GET(req: Request): Promise<Response> {
  const g = await requirePlataforma(req, { soloSesion: true });
  if (!g.ok) return g.response;
  return Response.json({ tokens: await listarTokens(g.actor.userId) });
}

const schema = z
  .object({
    name: z.string().trim().min(1).max(60),
    scopes: z.array(z.enum(["read", "provision"])).min(1),
    /** Días hasta que vence; sin valor, no vence (revocable siempre). */
    expiresInDays: z.number().int().min(1).max(365).optional(),
  })
  .strict();

/** Crea un token. Se devuelve UNA vez; después solo sus últimos 4. */
export async function POST(req: Request): Promise<Response> {
  const g = await requirePlataforma(req, { soloSesion: true });
  if (!g.ok) return g.response;
  const body = await leerJson(req);
  if (!body.ok) return body.response;
  const p = schema.safeParse(body.data);
  if (!p.success) {
    return errorPlataforma(
      422,
      "invalid_body",
      "Datos inválidos",
      p.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }))
    );
  }
  const expiresAt = p.data.expiresInDays ? new Date(Date.now() + p.data.expiresInDays * 86_400_000) : null;
  const r = await crearToken(g.actor.userId, { name: p.data.name, scopes: p.data.scopes, expiresAt }, g.actor.ip);
  return Response.json({ token: r.token, ...r.publico }, { status: 201 });
}
