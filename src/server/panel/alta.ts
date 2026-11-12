import { getDb } from "@/lib/db";
import { comoPanel } from "@/lib/db/contexto";
import { crearNegocio, type DatosAlta, type NegocioCreado } from "@/server/auth/alta";
import { anotarEnElPanel } from "@/server/panel/datos";

/**
 * 076 (D16) — El alta de un negocio desde el panel de Andres: la MISMA
 * `crearNegocio()` del comando (una transacción, contraseña de 24 caracteres
 * mostrada una sola vez). Es la única escritura del panel fuera del rol
 * `vocero_panel`: corre con el usuario de la app dentro del negocio NUEVO
 * (`conNegocio`, que pone `crearNegocio`). Escribe; no lee nada de pacientes.
 *
 * Se llama FUERA de `comoPanel` (desde el panel no se entra a un negocio); la
 * anotación en el registro, en cambio, va dentro. La contraseña nunca va al
 * registro ni a un log.
 */
export async function altaDesdeElPanel(superadminId: string, datos: DatosAlta): Promise<NegocioCreado> {
  const creado = await crearNegocio(getDb(), datos);
  try {
    await comoPanel(superadminId, () =>
      anotarEnElPanel("alta_negocio", creado.organizationId, { correo: creado.correo, nombre: creado.nombre })
    );
  } catch {
    // El negocio ya existe y la contraseña hay que mostrarla igual: sin la
    // anotación se avisa en el log (sin datos) y se sigue.
    console.error(`[panel] alta sin anotar en el registro: ${creado.organizationId}`);
  }
  return creado;
}
