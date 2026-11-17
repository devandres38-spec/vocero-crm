import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BotonSalir } from "@/components/plataforma/boton-salir";

export const dynamic = "force-dynamic";

/**
 * 069 — La organización existe y es tuya, pero la plataforma la suspendió.
 * Los mensajes que lleguen se siguen guardando: al reactivarla no se pierde
 * nada.
 */
export default function SuspendidaPage() {
  return (
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle>Organización suspendida</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-text-2">
        <p>
          Este negocio está suspendido temporalmente. Los mensajes que te
          escriban se siguen guardando y los verás en cuanto se reactive.
        </p>
        <p>Si crees que es un error, contacta a quien administra tu cuenta.</p>
        <BotonSalir />
      </CardContent>
    </Card>
  );
}
