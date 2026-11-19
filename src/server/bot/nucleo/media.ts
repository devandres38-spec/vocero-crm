import { apiError } from "@/lib/api";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";
import { downloadGraphMedia, MediaFetchError } from "@/server/whatsapp/media";

/** Límite para el bot (transcribe audio/imagen; nunca documentos de 100 MB). */
export const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

/**
 * 070 (D5) — Descarga de un adjunto de Meta para un cerebro, con la
 * organización ya resuelta. El token de WhatsApp NO sale del CRM.
 *
 * Quien llama decide si exige antes que el adjunto sea de un mensaje de esa
 * organización (`/api/brains` sí; ver su ruta).
 */
export async function descargarAdjunto(organizationId: string, mediaId: string): Promise<Response> {
  const creds = await getCredentialsByOrg(organizationId);
  if (!creds) {
    return apiError(409, "no_connection", "WhatsApp no está conectado");
  }

  if (!/^[\w.-]{1,64}$/.test(mediaId)) {
    return apiError(422, "invalid", "mediaId inválido");
  }

  try {
    const { data, mimeType } = await downloadGraphMedia(
      creds.token,
      mediaId,
      MAX_MEDIA_BYTES
    );
    return new Response(new Uint8Array(data), {
      headers: {
        "content-type": mimeType ?? "application/octet-stream",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof MediaFetchError) {
      if (err.message.includes("límite")) {
        return apiError(413, "too_large", "El adjunto excede el límite de 16 MB");
      }
      return apiError(
        err.gone ? 404 : 502,
        "media_download_failed",
        err.message
      );
    }
    return apiError(502, "media_download_failed", "No se pudo descargar el adjunto");
  }
}
