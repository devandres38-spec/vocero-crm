import { redirect } from "next/navigation";
import { getSessionOrNull, paginaConSesion } from "@/lib/auth/session";
import { guideFirst } from "@/server/onboarding/guide";
import { esSesionDeSuperadmin } from "@/server/panel/guard";

export const dynamic = "force-dynamic";

/**
 * La raíz decide a dónde se entra (issue #86): mientras falte un paso de la
 * guía de inicio o el agente siga apagado, a `/onboarding`; con todo listo,
 * a la Bandeja como siempre. Sin sesión, `/inbox` manda al login.
 *
 * 076 — El superadmin no es de ningún negocio (no tiene membresía): va a su
 * panel, `/admin`, que decide si le falta activar el segundo factor.
 */
async function Home() {
  const session = await getSessionOrNull();
  if (!session && (await esSesionDeSuperadmin())) redirect("/admin");
  if (session && (await guideFirst(session))) redirect("/onboarding");
  redirect("/inbox");
}

// 075 — Dentro del negocio de la sesión (RLS).
export default paginaConSesion(Home);
