import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { clientIp } from "@/lib/rate-limit";
import { esPlataforma } from "@/lib/tenancy";
import { emitirPase } from "@/server/platform/pase";
import { hostDeHeaders } from "@/server/tenant/host";

export const dynamic = "force-dynamic";

const cuerpo = z.object({ organizationId: z.string().min(1).max(64) });

/**
 * 069 (staging) — Emite un pase de un solo uso (60 s) para entrar al
 * subdominio de un negocio desde la raíz: `/empresas` (miembros), y los
 * botones «Abrir negocio» / «Entrar» del panel (Super-Admin con membresía o
 * soporte vigente). Solo con sesión de una persona: un token `alp_` nunca
 * abre sesiones de navegador. Solo `multi`; si no, 404.
 */
export async function POST(req: Request): Promise<Response> {
  if (!esPlataforma()) return new Response(null, { status: 404 });
  // Mismo origen: un formulario de otro sitio no puede pedir pases.
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== hostDeHeaders(req.headers)) return new Response(null, { status: 403 });
    } catch {
      return new Response(null, { status: 403 });
    }
  }
  const s = await getAuth().api.getSession({ headers: req.headers });
  if (!s) return Response.json({ error: { code: "no_autenticado", message: "Inicia sesión" } }, { status: 401 });
  let datos: unknown;
  try {
    datos = await req.json();
  } catch {
    datos = null;
  }
  const b = cuerpo.safeParse(datos);
  if (!b.success) return Response.json({ error: { code: "cuerpo_invalido", message: "Falta organizationId" } }, { status: 422 });
  const r = await emitirPase(s.user.id, b.data.organizationId, clientIp(req.headers));
  if (!r.ok) return Response.json({ error: { code: r.error.code, message: r.error.code } }, { status: r.error.status });
  return Response.json({ url: r.url, expiresAt: r.expiresAt });
}
