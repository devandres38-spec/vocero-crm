import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CambiarContrasena } from "@/components/cuenta/cambiar-contrasena";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * 076 — «Mi cuenta» para el personal de cualquier negocio (todos los roles).
 * Fuera del layout de la app a propósito: cuando la contraseña la puso otra
 * persona, ese layout manda aquí hasta cambiarla, y desde aquí no debe
 * rebotar. Solo usa la sesión de Better Auth; no lee datos del negocio.
 */
export default async function Cuenta() {
  const s = await getAuth().api.getSession({ headers: await headers() });
  if (!s) redirect("/login");
  const obligatorio = (s.user as { debeCambiarContrasena?: boolean }).debeCambiarContrasena === true;

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-subtle p-4">
      <div className="brand-grid absolute inset-0" aria-hidden />
      <div className="relative w-full max-w-md">
        {!obligatorio && (
          <Link href="/" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-text-3">
            <ArrowLeft className="size-4" aria-hidden /> Volver
          </Link>
        )}
        <Card className="shadow-md">
          <CardHeader>
            <CardTitle>Mi cuenta</CardTitle>
            <p className="text-sm text-text-3">{s.user.email}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {obligatorio && (
              <p className="rounded-md border border-warning-soft bg-warning-tint p-3 text-sm text-warning-text">
                Tu contraseña la puso otra persona. Pon tu propia contraseña para seguir.
              </p>
            )}
            <CambiarContrasena alTerminar="/" />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
