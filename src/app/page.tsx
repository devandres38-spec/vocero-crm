import { redirect } from "next/navigation";
import { getSessionOrNull } from "@/lib/auth/session";
import { guideFirst } from "@/server/onboarding/guide";
import { esPlataforma } from "@/lib/tenancy";
import { experienciaDe } from "@/server/verticals/experiencia";

export const dynamic = "force-dynamic";

/**
 * La raíz decide a dónde se entra (issue #86): mientras falte un paso de la
 * guía de inicio o el agente siga apagado, a `/onboarding`; con todo listo,
 * a la Bandeja como siempre. Sin sesión, `/inbox` manda al login.
 *
 * 072 (D7) — Con un Vertical Pack que tiene Inicio, a `/inicio` en vez de
 * la Bandeja.
 *
 * 069 (H-02) — En modo plataforma, el Super-Admin en el dominio raíz va
 * directo a `/platform` (sin rebotar por `/inbox`).
 */
export default async function Home() {
  if (esPlataforma() && (await superAdminEnLaRaiz())) redirect("/platform");
  const session = await getSessionOrNull();
  if (session && (await guideFirst(session))) redirect("/onboarding");
  // 072 (D7) — Con un Vertical Pack que define Inicio, se entra por ahí; sin
  // él (todos los negocios `default`), a la Bandeja como siempre.
  if (session && (await experienciaDe(session.organizationId)).inicio) redirect("/inicio");
  redirect("/inbox");
}

/** Solo en `multi`: lo de la plataforma no se carga en `single`. */
async function superAdminEnLaRaiz(): Promise<boolean> {
  const [
    { headers },
    { contextoActual },
    { dominioBase },
    { hostDeHeaders, slugDelHost },
    { plataformaPrimero },
    { esSuperAdmin },
  ] = await Promise.all([
    import("next/headers"),
    import("@/lib/auth/session"),
    import("@/lib/tenancy"),
    import("@/server/tenant/host"),
    import("@/server/tenant/inicio"),
    import("@/server/tenant/consultas"),
  ]);
  const ctx = await contextoActual();
  if (ctx.kind === "plataforma") return true;
  if (ctx.kind !== "organizacion" || ctx.via !== "miembro") return false;
  const base = dominioBase();
  const hostEsRaiz =
    slugDelHost(hostDeHeaders(await headers()), base).tipo === "raiz";
  return plataformaPrimero({
    multi: true,
    base,
    hostEsRaiz,
    superAdmin: await esSuperAdmin(ctx.userId),
  });
}
