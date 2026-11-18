import { notFound } from "next/navigation";
import { AdsClient } from "@/components/settings/ads-client";
import { atribucionActiva } from "@/server/modulos/consulta";
import { getSessionOrNull } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AdsSettingsPage() {
  // Sin la bandera esta pantalla no existe en esta instancia.
  if (!atribucionActiva(await getSessionOrNull())) notFound();
  return <AdsClient />;
}
