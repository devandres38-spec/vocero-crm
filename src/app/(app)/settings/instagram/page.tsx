import { notFound } from "next/navigation";
import { InstagramClient } from "@/components/settings/instagram-client";
import { canalActivo } from "@/server/modulos/consulta";
import { getSessionOrNull } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function InstagramSettingsPage() {
  // Sin el canal encendido esta pantalla no existe en esta instancia (ADR-001).
  if (!canalActivo(await getSessionOrNull(), "instagram")) notFound();
  return <InstagramClient />;
}
