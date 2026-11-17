import { GestorTokens } from "@/components/plataforma/gestor-tokens";
import { requirePlataformaPagina } from "@/server/platform/guardia";
import { listarTokens } from "@/server/platform/tokens";

export const dynamic = "force-dynamic";

/**
 * 069 (D14) — Tokens personales `alp_…` para la API y el MCP. Cada uno es de
 * quien lo crea: la auditoría dice qué persona hizo cada cambio por máquina.
 */
export default async function TokensPage() {
  const actor = await requirePlataformaPagina();
  return <GestorTokens inicial={await listarTokens(actor.userId)} />;
}
