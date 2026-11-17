import { notFound } from "next/navigation";
import { MessengerClient } from "@/components/settings/messenger-client";
import { canalActivo } from "@/server/modulos/consulta";
import { getSessionOrNull } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function MessengerSettingsPage() {
  // Sin el canal encendido esta pantalla no existe en esta instancia (ADR-001).
  if (!canalActivo(await getSessionOrNull(), "messenger")) notFound();
  return <MessengerClient />;
}
