import { InboxClient } from "@/components/inbox/inbox-client";
import { canConfigure } from "@/lib/auth/roles";
import { getSessionOrNull } from "@/lib/auth/session";
import { modulosDe } from "@/server/modulos/consulta";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  /**
   * 014 — Qué bandejas existen se decide en el servidor, no mirando los datos.
   * Si se dedujera de las conversaciones cargadas, la marca de canal aparecería
   * y desaparecería sola: una instancia con Instagram encendido pero sin DMs
   * todavía se vería como una instancia de un solo canal, y el primer mensaje
   * repintaría la lista entera.
   */
  // 069 — Los canales de ESTA organización (techo ∧ organización).
  const session = await getSessionOrNull();
  const channels = modulosDe(session).channels;

  // 026 — Eliminar una conversación es de quien administra el negocio. El
  // servidor lo exige en la ruta; esto solo decide si la opción se enseña.

  return <InboxClient channels={channels} canDelete={canConfigure(session?.role)} />;
}
