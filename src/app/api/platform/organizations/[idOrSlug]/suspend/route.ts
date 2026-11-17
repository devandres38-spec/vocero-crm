import { cambiarEstadoHttp } from "@/server/platform/estado-http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ idOrSlug: string }> };

/** 069 — Suspende: no se usa la app ni se envía; la ingesta sigue. */
export async function POST(req: Request, ctx: Params): Promise<Response> {
  return cambiarEstadoHttp(req, (await ctx.params).idOrSlug, "suspendida");
}
