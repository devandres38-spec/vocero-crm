import type { OrganizationBlueprint } from "@/lib/platform/blueprint";
import { guardarFichaFields } from "@/server/ficha/esquema";
import { BlueprintError } from "@/server/platform/blueprint/errores";
import type { Tx } from "./metadata";

/**
 * 072 (D9) — Los campos de la ficha, por la MISMA puerta que Ajustes → Ficha
 * (`guardarFichaFields`): reemplazo completo, idempotente, clave y tipo
 * inmutables. Quitar un campo no borra los valores guardados.
 */
export async function aplicarFichaFields(
  tx: Tx,
  organizationId: string,
  deseado: NonNullable<OrganizationBlueprint["fichaFields"]>
): Promise<boolean> {
  const r = await guardarFichaFields(organizationId, deseado.fields, tx);
  if (!r.ok) {
    throw new BlueprintError(
      "tipo_inmutable",
      422,
      r.claves.map((k) => ({ path: `fichaFields.fields.${k}`, message: "tipo_inmutable" }))
    );
  }
  return r.cambio;
}
