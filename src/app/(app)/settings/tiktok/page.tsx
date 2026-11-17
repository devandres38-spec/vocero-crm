import { notFound } from "next/navigation";
import { TiktokClient } from "@/components/settings/tiktok-client";
import { canalActivo } from "@/server/modulos/consulta";
import { getSessionOrNull } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function TiktokSettingsPage() {
  // Sin el canal encendido esta pantalla no existe en esta instancia (ADR-001).
  if (!canalActivo(await getSessionOrNull(), "tiktok")) notFound();
  return <TiktokClient />;
}
