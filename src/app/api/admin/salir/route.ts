import { getAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * 076 — Cierra la sesión y vuelve al login. Es a donde manda el panel cuando
 * la sesión ya no sirve (más de 12 h, o de antes de activar el segundo
 * factor), y el «Salir» de su menú.
 */
export async function GET(req: Request): Promise<Response> {
  const destino = new URL("/login", req.url);
  const salida = new Response(null, { status: 303, headers: { Location: destino.toString() } });
  try {
    const r = await getAuth().api.signOut({ headers: req.headers, asResponse: true });
    for (const cookie of r.headers.getSetCookie()) salida.headers.append("Set-Cookie", cookie);
  } catch {
    // Sin sesión: ya está fuera.
  }
  return salida;
}
