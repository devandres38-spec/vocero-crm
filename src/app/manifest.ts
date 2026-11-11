import type { MetadataRoute } from "next";
import { DEFAULT_BRANDING } from "@/lib/branding";
import { productName } from "@/lib/channels";
import { buildManifest } from "@/lib/pwa";
import { marcaDeLaPeticion } from "@/server/marca-de-la-peticion";
import { enabledChannels } from "@/server/channels/enabled";

export const dynamic = "force-dynamic";

/**
 * 048 — El manifest de la app instalable, con la marca de la organización
 * (`/manifest.webmanifest`). Público: el navegador lo pide sin sesión.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const branding = (await marcaDeLaPeticion().catch(() => null))?.branding ?? DEFAULT_BRANDING;
  return buildManifest(branding, `${productName([...enabledChannels()])} de ${branding.name}`);
}
