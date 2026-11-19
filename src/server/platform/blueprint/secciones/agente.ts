import { eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import type { OrganizationBlueprint } from "@/lib/platform/blueprint";
import { herramientasEfectivas } from "@/lib/agent-roles";
import { igualProfundo, type Tx } from "./metadata";

/**
 * 069 (D12) — El perfil del agente: los mismos campos que Ajustes → Agente,
 * menos el interruptor (`enabled`), que exige un cerebro sano y en modo
 * plataforma llega con el despacho por organización (070). Merge por campo:
 * lo que el Blueprint no trae se conserva.
 */

type Agente = NonNullable<OrganizationBlueprint["agent"]>;
const CAMPOS = [
  "name",
  "tone",
  "role",
  "tools",
  "instructions",
  "escalationRules",
  "greeting",
  // 071
  "treatment",
  "stallEnabled",
] as const;

/**
 * Auditoría 071 (B-4): las herramientas se guardan como las guarda Ajustes →
 * Agente (`herramientasEfectivas`: `escalar` siempre, orden del catálogo, sin
 * claves desconocidas). Comparar normalizado también es lo que hace
 * idempotente reaplicar un Blueprint con otro orden.
 */
function normalizar(campo: (typeof CAMPOS)[number], valor: unknown): unknown {
  if (campo === "tools" && Array.isArray(valor)) return herramientasEfectivas(valor as string[]);
  return valor;
}

export async function aplicarAgente(tx: Tx, organizationId: string, deseado: Agente): Promise<boolean> {
  const [actual] = await tx
    .select({
      id: schema.agentProfile.id,
      name: schema.agentProfile.name,
      tone: schema.agentProfile.tone,
      role: schema.agentProfile.role,
      tools: schema.agentProfile.tools,
      instructions: schema.agentProfile.instructions,
      escalationRules: schema.agentProfile.escalationRules,
      greeting: schema.agentProfile.greeting,
      treatment: schema.agentProfile.treatment,
      stallEnabled: schema.agentProfile.stallEnabled,
    })
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);

  const cambios: Record<string, unknown> = {};
  for (const campo of CAMPOS) {
    const v = normalizar(campo, deseado[campo]);
    if (v === undefined) continue;
    if (!actual || !igualProfundo(normalizar(campo, actual[campo]) ?? null, v ?? null)) cambios[campo] = v;
  }
  if (Object.keys(cambios).length === 0) return false;

  if (!actual) {
    await tx.insert(schema.agentProfile).values({ id: newId("agentProfile"), organizationId, ...cambios });
  } else {
    await tx
      .update(schema.agentProfile)
      .set({ ...cambios, updatedAt: new Date() })
      .where(eq(schema.agentProfile.id, actual.id));
  }
  return true;
}
