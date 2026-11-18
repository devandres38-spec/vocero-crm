import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { checkRateLimit, clientIp, PASE_IP_RATE_LIMIT, PASE_RATE_LIMIT } from "@/lib/rate-limit";
import { dominioBase, esPlataforma } from "@/lib/tenancy";
import { emitirPase } from "@/server/platform/pase";
import { hostDeHeaders, slugDelHost } from "@/server/tenant/host";

export const dynamic = "force-dynamic";

function demasiados(): Response {
  return Response.json(
    { error: { code: "demasiados_intentos", message: "Demasiados pases; espera un momento" } },
    { status: 429, headers: { "retry-after": "60" } }
  );
}

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
  const host = hostDeHeaders(req.headers);
  // F-04 — Solo en el dominio raíz: en un subdominio de negocio no existe.
  if (slugDelHost(host, dominioBase()).tipo !== "raiz") return new Response(null, { status: 404 });
  // Mismo origen y obligatorio: un navegador siempre lo manda en un POST;
  // sin él (o de otro sitio), no hay pase.
  const origin = req.headers.get("origin");
  try {
    if (!origin || new URL(origin).host !== host) return new Response(null, { status: 403 });
  } catch {
    return new Response(null, { status: 403 });
  }
  const ip = clientIp(req.headers);
  if (!checkRateLimit(`pase-ip:${ip}`, PASE_IP_RATE_LIMIT).allowed) return demasiados();
  const s = await getAuth().api.getSession({ headers: req.headers });
  if (!s) return Response.json({ error: { code: "no_autenticado", message: "Inicia sesión" } }, { status: 401 });
  if (!checkRateLimit(`pase:${s.user.id}`, PASE_RATE_LIMIT).allowed) return demasiados();
  let datos: unknown;
  try {
    datos = await req.json();
  } catch {
    datos = null;
  }
  const b = cuerpo.safeParse(datos);
  if (!b.success) return Response.json({ error: { code: "cuerpo_invalido", message: "Falta organizationId" } }, { status: 422 });
  const r = await emitirPase(s.user.id, b.data.organizationId, ip);
  if (!r.ok) return Response.json({ error: { code: r.error.code, message: r.error.code } }, { status: r.error.status });
  return Response.json({ url: r.url, expiresAt: r.expiresAt });
}
