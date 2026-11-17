import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AceptarInvitacion } from "@/components/plataforma/aceptar-invitacion";
import { leerInvitacion } from "@/server/platform/aceptar";

export const dynamic = "force-dynamic";

const NO_VIGENTE: Record<string, { titulo: string; texto: string }> = {
  vencida: {
    titulo: "Esta invitación venció",
    texto: "Los enlaces duran 7 días. Pide uno nuevo a quien te invitó.",
  },
  usada: {
    titulo: "Esta invitación ya se usó",
    texto: "Cada enlace sirve una sola vez. Si ya tienes cuenta, inicia sesión.",
  },
  revocada: {
    titulo: "Esta invitación ya no es válida",
    texto: "Quien te invitó la canceló o generó un enlace más reciente.",
  },
  inexistente: {
    titulo: "Enlace no válido",
    texto: "Revisa que lo copiaste completo o pide uno nuevo.",
  },
};

/**
 * 069 (US3) — Aceptar una invitación. La página no muestra nada del negocio
 * si el enlace no es válido; si lo es, solo su nombre y el correo invitado.
 */
export default async function InvitacionPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const info = await leerInvitacion(token);
  if (info.estado !== "vigente") {
    const m = NO_VIGENTE[info.estado]!;
    return (
      <Card className="shadow-md">
        <CardHeader>
          <CardTitle>{m.titulo}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-text-2">{m.texto}</CardContent>
      </Card>
    );
  }
  const s = await getAuth().api.getSession({ headers: await headers() });
  return (
    <AceptarInvitacion
      token={token}
      negocio={info.organizacion!.name}
      email={info.email!}
      cuentaExiste={info.cuentaExiste === true}
      sesionEmail={s?.user.email ?? null}
    />
  );
}
