import { FAVICON_ASSET, MAX_FAVICON_BYTES, sniffFaviconMime } from "@/lib/favicon";
import type { BrandingFavicon } from "@/lib/branding";
import { getBranding, saveBranding } from "@/server/branding";
import { deleteMediaFile, saveMediaFile } from "@/server/whatsapp/media";

/**
 * El icono (logo de pestaña) de un negocio: subir y quitar. Un solo servicio
 * para Ajustes → Marca (el dueño) y para la ficha del negocio en `/platform`
 * (la agencia, auditoría 069 Fix-C), con las mismas validaciones.
 */

export type ErrorIcono = { status: 413 | 422; code: "empty" | "too_large" | "unsupported"; message: string };

export async function subirIcono(
  organizationId: string,
  buf: Uint8Array
): Promise<{ ok: true; favicon: BrandingFavicon } | { ok: false; error: ErrorIcono }> {
  if (buf.byteLength === 0) {
    return { ok: false, error: { status: 422, code: "empty", message: "No llegó ningún archivo" } };
  }
  if (buf.byteLength > MAX_FAVICON_BYTES) {
    return {
      ok: false,
      error: {
        status: 413,
        code: "too_large",
        message: `El icono no puede pasar de ${Math.round(MAX_FAVICON_BYTES / 1024)} KB`,
      },
    };
  }
  // El tipo sale de los BYTES, no de lo que declare el cliente: decir
  // `image/png` y mandar un HTML es la forma clásica de colar un documento
  // donde se espera una imagen, y esto se sirve desde el mismo dominio.
  const mime = sniffFaviconMime(buf);
  if (!mime) {
    return {
      ok: false,
      error: { status: 422, code: "unsupported", message: "Formato no reconocido. Usa PNG, SVG, ICO, JPEG o WebP." },
    };
  }

  await saveMediaFile(organizationId, FAVICON_ASSET, buf, mime);
  const branding = await getBranding(organizationId);
  // Marca de tiempo y no un contador: al quitar el icono no queda dónde
  // recordar por cuál íbamos, así que un contador reiniciaría en 1 y la URL
  // `?v=u1` sería la MISMA que la del logo anterior — el navegador seguiría
  // enseñando el viejo, que es justo lo que este número existe para evitar.
  const favicon = { mime, version: Date.now() } as BrandingFavicon;
  await saveBranding(organizationId, { ...branding, favicon });
  return { ok: true, favicon };
}

/** Quitar el subido y volver al generado de la marca. */
export async function quitarIcono(organizationId: string): Promise<void> {
  const branding = await getBranding(organizationId);
  await saveBranding(organizationId, { ...branding, favicon: null });
  // El archivo se borra DESPUÉS de que la marca ya no lo referencia: si esto
  // falla, queda un archivo huérfano —inofensivo— en vez de una marca
  // apuntando a algo que ya no está.
  await deleteMediaFile(organizationId, FAVICON_ASSET).catch(() => null);
}
