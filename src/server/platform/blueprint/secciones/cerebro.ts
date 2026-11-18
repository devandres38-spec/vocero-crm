import { eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { auditar } from "@/server/platform/auditoria";
import { BlueprintError } from "@/server/platform/blueprint/errores";
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
  if (destino) {
    const [d] = await tx
      .select({ status: schema.brainDeployment.status })
      .from(schema.brainDeployment)
      .where(eq(schema.brainDeployment.id, destino))
      .limit(1);
    if (!d) {
      throw new BlueprintError("cerebro_no_encontrado", 422, [
        { path: "brain.deployment", message: "No existe ese despliegue de cerebro" },
      ]);
    }
    if (d.status !== "activo") {
      throw new BlueprintError("cerebro_pausado", 422, [
        { path: "brain.deployment", message: "Ese despliegue está pausado" },
      ]);
    }
  }
  const [org] = await tx
    .select({ actual: schema.organization.brainDeploymentId })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  const antes = org?.actual ?? null;
  if (antes === destino) return false;
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
