import { ActivarSegundoFactor } from "@/components/panel/activar-segundo-factor";
import { paginaDelSegundoFactor } from "@/server/panel/ruta";

export const dynamic = "force-dynamic";

/**
 * 076 — La única pantalla del panel sin segundo factor: activarlo. Con él ya
 * activado, manda a `/admin`; a quien no es superadmin, 404.
 */
async function SegundoFactor(superadmin: { correo: string }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-subtle p-4">
      <div className="brand-grid absolute inset-0" aria-hidden />
      <div className="relative w-full max-w-md">
        <ActivarSegundoFactor correo={superadmin.correo} />
      </div>
    </main>
  );
}

export default paginaDelSegundoFactor(SegundoFactor);
