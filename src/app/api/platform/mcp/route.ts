import { clientIp } from "@/lib/rate-limit";
import { mcpActivo } from "@/lib/tenancy";
import { origenPermitido } from "@/server/platform/mcp/origen";
import type { ActorPlataforma } from "@/server/platform/guardia";
import { ERRORES_RPC, procesarMensaje, versionDePeticion, type RespuestaRpc } from "@/server/platform/mcp/servidor";
import { tokenDeHeaders, verificarToken } from "@/server/platform/tokens";

export const dynamic = "force-dynamic";

/**
 * 069 (D15, US9) — Servidor MCP de aprovisionamiento (Streamable HTTP, sin
 * estado). Existe solo con `TENANCY=multi` y `PLATFORM_MCP=on`: si no, 404.
 *
 * Solo token personal `alp_…` (Bearer); nunca la cookie de sesión, para que
 * una página de otro sitio no pueda usar la sesión de un Super-Admin.
 */

function noAutorizado(): Response {
  return Response.json(
    { error: { code: "token_invalido", message: "Falta un token alp_ válido (Authorization: Bearer)" } },
    { status: 401, headers: { "www-authenticate": 'Bearer realm="aliantis-mcp"' } }
  );
}

export async function POST(req: Request): Promise<Response> {
  if (!mcpActivo()) return new Response(null, { status: 404 });
  if (!origenPermitido(req.headers.get("origin"))) return new Response(null, { status: 403 });
  const version = versionDePeticion(req.headers.get("mcp-protocol-version"));
  if (!version) {
    return Response.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: ERRORES_RPC.invalidRequest, message: "MCP-Protocol-Version no soportada" },
      } satisfies RespuestaRpc,
      { status: 400 }
    );
  }

  const token = tokenDeHeaders(req.headers);
  if (!token) return noAutorizado();
  const ip = clientIp(req.headers);
  const v = await verificarToken(token, ip);
  if (!v) return noAutorizado();
  const actor: ActorPlataforma = { userId: v.userId, via: "mcp", tokenId: v.tokenId, ip, alcances: v.scopes };

  let cuerpo: unknown;
  try {
    cuerpo = await req.json();
  } catch {
    return Response.json({
      jsonrpc: "2.0",
      id: null,
      error: { code: ERRORES_RPC.parse, message: "JSON inválido" },
    } satisfies RespuestaRpc);
  }

  if (Array.isArray(cuerpo)) {
    const respuestas: RespuestaRpc[] = [];
    for (const m of cuerpo) {
      const r = await procesarMensaje(actor, (m ?? {}) as Record<string, unknown>, version);
      if (r) respuestas.push(r);
    }
    return respuestas.length ? Response.json(respuestas) : new Response(null, { status: 202 });
  }
  const r = await procesarMensaje(actor, (cuerpo ?? {}) as Record<string, unknown>, version);
  return r ? Response.json(r) : new Response(null, { status: 202 });
}

/** Sin flujo SSE ni sesiones: el servidor solo responde a POST. */
export async function GET(): Promise<Response> {
  return new Response(null, { status: mcpActivo() ? 405 : 404, headers: { allow: "POST" } });
}

export async function DELETE(): Promise<Response> {
  return new Response(null, { status: mcpActivo() ? 405 : 404, headers: { allow: "POST" } });
}
