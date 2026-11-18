import { raizPlataforma, urlDeRaiz } from "@/lib/tenancy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BotonSalir } from "@/components/plataforma/boton-salir";

export const dynamic = "force-dynamic";

/**
 * 069 — Hay sesión, pero no es de este negocio (o aún no eligió uno). No se
 * dice nada del negocio del host: ni si existe.
 */
export default function SinAccesoPage() {
  // El selector vive en el dominio raíz: en el subdominio de otro negocio el
  // host seguiría decidiendo por él.
  const plataforma = raizPlataforma();
  const raiz = plataforma ? urlDeRaiz(plataforma, "/empresas") : "/empresas";
  return (
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle>No perteneces a este negocio</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-text-2">
        <p>
          Tu cuenta no tiene acceso aquí. Si te invitaron, abre el enlace de la
          invitación o entra por la dirección de tu negocio.
        </p>
        <a href={raiz} className="block text-accent underline underline-offset-4">
          Ver mis empresas
        </a>
        <BotonSalir />
      </CardContent>
    </Card>
  );
}
