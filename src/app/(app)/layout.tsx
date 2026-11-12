import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { getSessionOrNull, paginaConSesion } from "@/lib/auth/session";
import { aparienciaActual } from "@/server/apariencia";
import { getBranding } from "@/server/branding";
import { AppShell } from "@/components/app-shell";
import { resolveCommit } from "@/lib/version";
import { agendaEnabled } from "@/server/agenda/flag";
import { enabledChannels } from "@/server/channels/enabled";
import { navKicker } from "@/lib/channels";

async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  const branding = await getBranding(session.organizationId);
  const authSession = await getAuth().api.getSession({
    headers: await headers(),
  });
  // 076 (respuesta 3 de Andres) — La contraseña la puso otra persona (el
  // alta, el dueño o un restablecimiento): primero, la suya.
  if ((authSession?.user as { debeCambiarContrasena?: boolean } | undefined)?.debeCambiarContrasena === true) {
    redirect("/cuenta");
  }
  // 062 — Para el botón de sol y luna: salta a la pareja del tema actual.
  const { apariencia } = await aparienciaActual(session.organizationId);

  return (
    <AppShell
      branding={branding}
      userName={authSession?.user.name ?? "Usuario"}
      role={session.role}
      apariencia={apariencia}
      // Se resuelve aquí, en el servidor: el cliente no ve `SOURCE_COMMIT`.
      // Baja con su procedencia, para que la insignia no presente como
      // verificado un commit que no salió del build (#50).
      commit={resolveCommit()}
      // Qué módulos opcionales existen se decide en el servidor y baja por
      // prop, igual que los canales de la Bandeja. El nav es un componente de
      // cliente: no puede —ni debe— leer variables de entorno.
      agenda={agendaEnabled()}
      kicker={navKicker([...enabledChannels()])}
    >
      {children}
    </AppShell>
  );
}

// 075 — Dentro del negocio de la sesión (RLS).
export default paginaConSesion(AppLayout);
