import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { contextoActual, destinoSinOrganizacion, getSessionOrNull } from "@/lib/auth/session";
import { aparienciaActual } from "@/server/apariencia";
import { getBranding } from "@/server/branding";
import { AppShell } from "@/components/app-shell";
import { resolveCommit } from "@/lib/version";
import { navKicker } from "@/lib/channels";
import { avisoIaDe } from "@/server/ai/aviso";
import { AvisoIaBanner } from "@/components/avisos/aviso-ia";
import { BandaSoporte } from "@/components/plataforma/banda-soporte";
import { agendaActiva, modulosDe } from "@/server/modulos/consulta";
import { esPlataforma, raizPlataforma, urlDeRaiz } from "@/lib/tenancy";
import { getRegionDeOrganizacion } from "@/server/region";
import { esSuperAdmin } from "@/server/tenant/consultas";
import { experienciaDe } from "@/server/verticals/experiencia";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSessionOrNull();
  if (!session) redirect(destinoSinOrganizacion(await contextoActual()));
  const branding = await getBranding(session.organizationId);
  const authSession = await getAuth().api.getSession({
    headers: await headers(),
  });
  // 062 — Para el botón de sol y luna: salta a la pareja del tema actual.
  const { apariencia } = await aparienciaActual(session.organizationId);
  // El agente encendido y sin con qué pensar se ve desde fuera igual que un
  // bot roto. Se resuelve en el servidor y en el layout para que se vea desde
  // CUALQUIER pantalla, no solo desde el panel de un contacto (#85).
  const aviso = await avisoIaDe(session.organizationId);
  // 072 (FR-003) — El Vertical Pack del negocio: baja resuelto y serializable.
  const experiencia = await experienciaDe(session.organizationId);

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
      agenda={agendaActiva(session)}
      kicker={navKicker(modulosDe(session).channels)}
      empresasUrl={empresasUrl()}
      plataformaUrl={await plataformaUrl(session.userId)}
      experiencia={experiencia}
      aviso={
        <>
          {session.via === "soporte" && session.grant && (
            <BandaSoporte level={session.grant.level} expiresAt={session.grant.expiresAt} zona={(await getRegionDeOrganizacion(session.organizationId)).timezone} />
          )}
          <AvisoIaBanner aviso={aviso} />
        </>
      }
    >
      {children}
    </AppShell>
  );
}

/** 069 (H-02) — El Super-Admin dentro de un negocio vuelve a su panel en un clic. */
async function plataformaUrl(userId: string): Promise<string | undefined> {
  if (!esPlataforma() || !(await esSuperAdmin(userId))) return undefined;
  const raiz = raizPlataforma();
  return raiz ? urlDeRaiz(raiz, "/platform") : "/platform";
}

/** 069 — En modo plataforma, el selector de empresas vive en el dominio raíz. */
function empresasUrl(): string | undefined {
  if (!esPlataforma()) return undefined;
  const raiz = raizPlataforma();
  return raiz ? urlDeRaiz(raiz, "/empresas") : "/empresas";
}
