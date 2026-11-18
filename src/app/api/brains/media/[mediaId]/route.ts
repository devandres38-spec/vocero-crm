import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { apiError } from "@/lib/api";
import { withBrain } from "@/server/brains/http";
import { descargarAdjunto } from "@/server/bot/nucleo/media";

export const dynamic = "force-dynamic";

/**
 * 070 — `GET /api/brains/media/{mediaId}`: el adjunto de un mensaje.
 *
 * A diferencia de `/api/bot/media` (una instancia = un negocio), aquí el id
 * tiene que ser de un adjunto que llegó a ESTA organización: con la
 * credencial de A no se descarga nada de B aunque se conozca su id de Meta.
 * Fuera de su organización es 404, igual que uno que no existe.
 */
export const GET = withBrain<{ params: Promise<{ mediaId: string }> }>(async (_req, ambito, ctx) => {
  const { mediaId } = await ctx.params;
  if (!/^[\w.-]{1,64}$/.test(mediaId)) {
    return apiError(422, "invalid", "mediaId inválido");
  }
  const [propio] = await getDb()
    .select({ id: schema.mediaAsset.id })
    .from(schema.mediaAsset)
    .where(
      and(
        eq(schema.mediaAsset.organizationId, ambito.organizationId),
        eq(schema.mediaAsset.waMediaId, mediaId)
      )
    )
    .limit(1);
  if (!propio) return apiError(404, "not_found", "Adjunto no encontrado");
  return descargarAdjunto(ambito.organizationId, mediaId);
});
