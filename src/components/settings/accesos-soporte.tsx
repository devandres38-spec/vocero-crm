import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getRegion } from "@/lib/region";
import type { AccesoSoporte } from "@/server/platform/soporte";

const fecha = (iso: string) => new Date(iso).toLocaleString(getRegion().locale, { dateStyle: "medium", timeStyle: "short" });

/**
 * 069 (US5-7) — Quién de la plataforma entró a tu negocio, con qué nivel, por
 * qué y hasta cuándo. Cada petición que hizo quedó registrada.
 */
export function AccesosSoporte({ accesos }: { accesos: AccesoSoporte[] }) {
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Accesos de soporte</CardTitle>
        <CardDescription>
          La plataforma solo puede ver tu negocio con un acceso con motivo y caducidad. Aquí está cada uno.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {accesos.length === 0 ? (
          <p className="text-sm text-text-3">Nadie de la plataforma ha entrado a tu negocio.</p>
        ) : (
          <ul className="divide-y text-sm">
            {accesos.map((a) => (
              <li key={a.id} className="py-2">
                <p>
                  <span className="font-medium">{a.actor}</span> ·{" "}
                  {a.level === "lectura" ? "solo lectura" : "configuración"}
                  {a.vigente ? <span className="text-warning-text"> · activo ahora</span> : null}
                </p>
                <p className="text-xs text-text-3">
                  «{a.reason}» · {fecha(a.createdAt)} → {a.revokedAt ? `cerrado ${fecha(a.revokedAt)}` : fecha(a.expiresAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
