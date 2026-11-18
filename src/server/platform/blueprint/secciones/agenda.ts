import { eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import type { OrganizationBlueprint } from "@/lib/platform/blueprint";
import {
  CalendarSettingsError,
  getSettings,
  siguienteConfiguracion,
  upsertSettings,
} from "@/server/agenda/settings";
import { BlueprintError } from "../errores";
import { igualProfundo, type Tx } from "./metadata";

/**
 * 069 (D12) — La agenda: el MISMO servicio que Ajustes → Agenda
 * (`upsertSettings`, con sus normalizaciones), dentro de la transacción del
 * Blueprint. Merge por campo. Con el módulo agenda apagado se guarda igual
 * (inerte) y se advierte: encenderla después la encuentra lista.
 */

type Agenda = NonNullable<OrganizationBlueprint["agenda"]>;

export async function aplicarAgenda(
  tx: Tx,
  organizationId: string,
  deseado: Agenda
): Promise<boolean> {
  const fila = await tx
    .select({ id: schema.calendarSettings.id })
    .from(schema.calendarSettings)
    .where(eq(schema.calendarSettings.organizationId, organizationId))
    .limit(1);
  const actual = await getSettings(organizationId, tx);
  let siguiente;
  try {
    siguiente = siguienteConfiguracion(actual, deseado);
  } catch (err) {
    if (err instanceof CalendarSettingsError) {
      throw new BlueprintError("agenda_invalida", 422, [{ path: "agenda", message: err.message }]);
    }
    throw err;
  }
  if (fila.length > 0 && igualProfundo(actual, siguiente)) return false;
  await upsertSettings(organizationId, deseado, tx);
  return true;
}
