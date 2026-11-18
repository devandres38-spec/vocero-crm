import { eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { auditar } from "@/server/platform/auditoria";
import { exigirDespliegueActivo } from "@/server/brains/deployment";
import type { Actor } from "@/server/platform/invitaciones";
import type { Tx } from "./metadata";

/**
 * 070 (D12) — `brain`: qué despliegue de cerebro atiende al negocio.
 * `{ deployment: "brn_…" }` lo asigna; `null` lo quita (bandeja manual).
 *
 * Solo un id: el Blueprint nunca lleva URLs ni secretos de un cerebro, y no
 * crea despliegues (eso solo en el panel, porque devuelve el secreto). Un id
 * inexistente o pausado es un error de validación con su ruta exacta.
 */
export async function aplicarCerebro(
  tx: Tx,
  actor: Actor,
  organizationId: string,
  deseado: { deployment: string } | null
): Promise<boolean> {
  const destino = deseado?.deployment ?? null;
  const [org] = await tx
    .select({ actual: schema.organization.brainDeploymentId })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  const antes = org?.actual ?? null;
  // Auditoría 070 (A-9): «sin cambios» PRIMERO. `get_blueprint` exporta el
  // cerebro asignado aunque esté pausado, y re-aplicar ese mismo Blueprint
  // (o editar otra sección) fallaba con 422 `cerebro_pausado`.
  if (antes === destino) return false;
  // Solo al asignar uno DISTINTO se exige que exista y esté activo, con su
  // fila bloqueada hasta confirmar (M-2).
  if (destino) await exigirDespliegueActivo(tx as never, destino);
  await tx
    .update(schema.organization)
    .set({ brainDeploymentId: destino })
    .where(eq(schema.organization.id, organizationId));
  await auditar(
    {
      actorUserId: actor.userId,
      action: "cerebro_asignado",
      organizationId,
      via: actor.via,
      tokenId: actor.tokenId,
      ip: actor.ip,
      detail: { antes, despues: destino, desde: "blueprint" },
    },
    tx
  );
  return true;
}
