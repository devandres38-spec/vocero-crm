import { notFound } from "next/navigation";
import { ChannelsClient } from "@/components/settings/channels-client";
import { ZERNIO_CHANNELS } from "@/server/zernio/conexiones";
import { canalActivo } from "@/server/modulos/consulta";
import { getSessionOrNull } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function ChannelsSettingsPage() {
  // Con WhatsApp solo esta pantalla no existe en esta instancia (ADR-001).
  const session = await getSessionOrNull();
  if (!ZERNIO_CHANNELS.some((c) => canalActivo(session, c))) notFound();
  return <ChannelsClient />;
}
