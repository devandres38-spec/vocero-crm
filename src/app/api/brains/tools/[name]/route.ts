import { ejecutarLlamada } from "@/server/brains/herramientas";
import { withBrain } from "@/server/brains/http";

export const dynamic = "force-dynamic";

/**
 * 072-B (D14, FR-043) — `POST /api/brains/tools/{name}`: el cerebro ejecuta
 * una herramienta de un módulo encendido para ESTE negocio. Auth y 500 con
 * sobre: `withBrain`. Códigos, idempotencia y topes:
 * `src/server/brains/herramientas.ts` y el contrato brains-072 §4.
 */
export const POST = withBrain<{ params: Promise<{ name: string }> }>(async (req, ambito, ctx) => {
  const { name } = await ctx.params;
  return ejecutarLlamada(req, ambito, name);
});
