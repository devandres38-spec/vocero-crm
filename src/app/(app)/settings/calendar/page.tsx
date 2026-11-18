import { notFound } from "next/navigation";
import { AgendaClient } from "@/components/settings/agenda-client";
import { agendaActiva } from "@/server/modulos/consulta";
import { getSessionOrNull } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AgendaSettingsPage() {
  // Sin la bandera esta pantalla no existe en esta instancia.
  if (!agendaActiva(await getSessionOrNull())) notFound();
  return <AgendaClient />;
}
