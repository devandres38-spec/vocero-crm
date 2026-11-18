import { FAVICON_ASSET, generatedFaviconSvg } from "@/lib/favicon";
import { getBranding } from "@/server/branding";
import { readMediaFile } from "@/server/whatsapp/media";
import { auditar } from "@/server/platform/auditoria";
import { buscarOrganizacion } from "@/server/platform/blueprint/aplicar";
import { quitarIcono, subirIcono } from "@/server/branding-icono";
import { requirePlataforma } from "@/server/platform/guardia";
import { errorPlataforma, respuestaDeError } from "@/server/platform/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ idOrSlug: string }> };

/**
 * Auditoría 069 (Fix-C) — El logo (icono de pestaña) de un negocio desde su
 * ficha en `/platform`: la agencia lo sube sin abrir un acceso de soporte.
 * Es un binario, por eso no va en el Blueprint. Cuerpo crudo con su
 * `content-type`, mismas validaciones que Ajustes → Marca; queda auditado.
 */
/** Vista previa para el panel (desde el dominio raíz no hay host del negocio). */
export async function GET(req: Request, ctx: Params): Promise<Response> {
  const g = await requirePlataforma(req, { scope: "read" });
  if (!g.ok) return g.response;
  const org = await buscarOrganizacion((await ctx.params).idOrSlug);
  if (!org) return errorPlataforma(404, "organizacion_inexistente");
  const branding = await getBranding(org.id);
  const cabeceras = (mime: string): HeadersInit => ({
    "content-type": mime,
    // Un SVG subido es un documento: sin nada que ejecutar (igual que la ruta pública).
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    "x-content-type-options": "nosniff",
    "cache-control": "private, max-age=60",
  });
  if (branding.favicon) {
    try {
      const buf = await readMediaFile(org.id, FAVICON_ASSET);
      return new Response(new Uint8Array(buf), { headers: cabeceras(branding.favicon.mime) });
    } catch {
      // Archivo perdido: el generado.
    }
  }
  return new Response(generatedFaviconSvg(branding), { headers: cabeceras("image/svg+xml") });
}

export async function PUT(req: Request, ctx: Params): Promise<Response> {
  const g = await requirePlataforma(req, { scope: "provision" });
  if (!g.ok) return g.response;
  try {
    const org = await buscarOrganizacion((await ctx.params).idOrSlug);
    if (!org) return errorPlataforma(404, "organizacion_inexistente");
    const r = await subirIcono(org.id, new Uint8Array(await req.arrayBuffer()));
    if (!r.ok) return errorPlataforma(r.error.status, r.error.code, r.error.message);
    await auditar({
      actorUserId: g.actor.userId,
      action: "icono_cambiado",
      organizationId: org.id,
      via: g.actor.via,
      tokenId: g.actor.tokenId,
      ip: g.actor.ip,
      detail: { mime: r.favicon.mime },
    });
    return Response.json({ favicon: r.favicon });
  } catch (err) {
    return respuestaDeError(err);
  }
}

export async function DELETE(req: Request, ctx: Params): Promise<Response> {
  const g = await requirePlataforma(req, { scope: "provision" });
  if (!g.ok) return g.response;
  try {
    const org = await buscarOrganizacion((await ctx.params).idOrSlug);
    if (!org) return errorPlataforma(404, "organizacion_inexistente");
    await quitarIcono(org.id);
    await auditar({
      actorUserId: g.actor.userId,
      action: "icono_cambiado",
      organizationId: org.id,
      via: g.actor.via,
      tokenId: g.actor.tokenId,
      ip: g.actor.ip,
      detail: { quitado: true },
    });
    return Response.json({ favicon: null });
  } catch (err) {
    return respuestaDeError(err);
  }
}
