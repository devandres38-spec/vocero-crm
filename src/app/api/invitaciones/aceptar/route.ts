import { z } from "zod";
import { apiError } from "@/lib/api";
import { getAuth } from "@/lib/auth";
import { AUTH_RATE_LIMIT, checkRateLimit, clientIp } from "@/lib/rate-limit";
import { dominioBase } from "@/lib/tenancy";
import { AceptarError, aceptarInvitacion } from "@/server/platform/aceptar";

export const dynamic = "force-dynamic";

const schema = z
  .object({
    token: z.string().min(20).max(200),
    name: z.string().trim().min(1).max(120).optional(),
    password: z.string().min(8).max(128).optional(),
  })
  .strict();

/**
 * 069 (US3) — Aceptar una invitación. Pública (quien la usa aún no tiene
 * cuenta), con el mismo límite por IP que el login. El token tiene 256 bits:
 * adivinarlo no es el riesgo, pero un bucle sí ensuciaría la auditoría.
 */
export async function POST(req: Request): Promise<Response> {
  const ip = clientIp(req.headers);
  if (!checkRateLimit(`invitacion:${ip}`, AUTH_RATE_LIMIT).allowed) {
    return apiError(429, "rate_limited", "Demasiados intentos; espera unos minutos");
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return apiError(422, "invalid_body", "El body debe ser JSON válido");
  }
  const body = schema.safeParse(raw);
  if (!body.success) return apiError(422, "invalid_body", "Datos inválidos");

  const s = await getAuth().api.getSession({ headers: req.headers });
  try {
    const r = await aceptarInvitacion({
      token: body.data.token,
      sesion: s ? { userId: s.user.id, email: s.user.email } : null,
      nueva:
        body.data.name && body.data.password
          ? { name: body.data.name, password: body.data.password }
          : undefined,
      ip,
    });
    const base = dominioBase();
    return Response.json({
      ok: true,
      organizationId: r.organizationId,
      cuentaCreada: r.cuentaCreada,
      // A dónde ir: el subdominio del negocio (ahí el host decide).
      destino: base && r.slug ? `https://${r.slug}.${base}/` : "/",
    });
  } catch (err) {
    if (err instanceof AceptarError) return apiError(err.status, err.code, err.code);
    throw err;
  }
}
