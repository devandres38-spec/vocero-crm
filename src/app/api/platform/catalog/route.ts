import { catalogoPlataforma } from "@/server/platform/catalogo";
import { requirePlataforma } from "@/server/platform/guardia";

export const dynamic = "force-dynamic";

/** 069 (D13) — Valores válidos y JSON Schema del Blueprint. */
export async function GET(req: Request): Promise<Response> {
  const g = await requirePlataforma(req, { scope: "read" });
  if (!g.ok) return g.response;
  return Response.json(catalogoPlataforma());
}
