import type { OrganizationBlueprint, ResultadoBlueprint } from "@/lib/platform/blueprint";
import {
  crearInvitacion,
  esMiembroPorCorreo,
  invitacionPendiente,
  type Actor,
} from "@/server/platform/invitaciones";
import type { OrgParaBlueprint, Tx } from "./metadata";

/**
 * 069 — La invitación del `owner`. Idempotente: con una invitación pendiente
 * vigente para ese correo no se genera otra (el enlace ya se mostró una vez y
 * no se puede volver a mostrar); `regenerate` la revoca y emite una nueva.
 */
export async function aplicarOwner(
  tx: Tx,
  actor: Actor,
  org: OrgParaBlueprint,
  owner: NonNullable<OrganizationBlueprint["owner"]>,
  dryRun: boolean
): Promise<{ cambio: boolean; invitation: NonNullable<ResultadoBlueprint["invitation"]> }> {
  if (await esMiembroPorCorreo(tx, org.id, owner.email)) {
    return { cambio: false, invitation: { status: "ya_miembro" } };
  }
  const pendiente = await invitacionPendiente(tx, org.id, owner.email);
  if (pendiente && !owner.regenerate) {
    return { cambio: false, invitation: { status: "pendiente" } };
  }
  if (dryRun) return { cambio: true, invitation: { status: "se_generaria" } };
  const inv = await crearInvitacion(tx, actor, {
    organizationId: org.id,
    slug: org.slug,
    email: owner.email,
    role: "owner",
  });
  return {
    cambio: true,
    invitation: { status: "creada", url: inv.url, expiresAt: inv.expiresAt.toISOString() },
  };
}
