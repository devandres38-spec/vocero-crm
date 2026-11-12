import { CambiarContrasena } from "@/components/cuenta/cambiar-contrasena";
import { Encabezado, Seccion } from "@/components/panel/piezas";
import type { Superadmin } from "@/server/panel/guard";
import { paginaDelPanel } from "@/server/panel/ruta";

export const dynamic = "force-dynamic";

/**
 * 076 — Mi cuenta del superadmin: cambiar la contraseña. El segundo factor no
 * se cambia aquí: se reinicia solo con `superadmin:alta --reiniciar-segundo-factor`.
 */
async function Cuenta(superadmin: Superadmin) {
  return (
    <div className="mx-auto max-w-3xl">
      <Encabezado titulo="Mi cuenta" descripcion={superadmin.correo} />
      <Seccion titulo="Contraseña">
        <CambiarContrasena alTerminar="/admin" />
      </Seccion>
      <p className="mt-4 text-sm text-text-3">
        El segundo factor está activado y se pide en cada inicio de sesión. Si pierdes el teléfono y los códigos de
        respaldo, se reinicia con el comando del servidor.
      </p>
    </div>
  );
}

export default paginaDelPanel(Cuenta);
