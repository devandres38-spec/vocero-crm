import { withAuth } from "@/lib/api";
import { tamanoKb } from "@/lib/kb";
import { kbDelNegocio, recursosDe } from "@/server/kb";

export const dynamic = "force-dynamic";

/**
 * Tamaño estimado del knowledge base (FR-020).
 *
 * 074 (D8, E3) — En tokens estimados (`chars/4`) de lo que de verdad llega al
 * cerebro: las entradas ACTIVAS más los enlaces verificados, contra un
 * presupuesto de 8.000 tokens con aviso desde el 75 %. `chars`, `warnAt` y
 * `warning` siguen viajando (`warnAt` ahora en tokens).
 */
export const GET = withAuth(async (session) => {
  const [entries, resources] = await Promise.all([
    kbDelNegocio(session.organizationId),
    recursosDe(session.organizationId),
  ]);
  return Response.json(tamanoKb(entries, resources));
});
