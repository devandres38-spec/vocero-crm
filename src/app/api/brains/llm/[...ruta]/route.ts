import { apiError } from "@/lib/api";
import { requireBrain } from "@/server/brains/auth";
import { pensarPorElCerebro } from "@/server/bot/llm-proxy";

export const dynamic = "force-dynamic";
// Un modelo puede tardar en contestar: el default cortaría un turno sano.
export const maxDuration = 300;

/**
 * 070 (D6) — `POST /api/brains/llm/{ruta}`: el CRM piensa por una Nea
 * `multiorg` con la llave PROPIA del negocio (Ajustes → IA), nunca con
 * `OPENROUTER_*` del entorno. El SDK de OpenAI añade `chat/completions` a su
 * `base_url` (`{CRM}/api/brains/llm`); es la única ruta que se reenvía.
 *
 * Autentica con la credencial derivada (la misma con la que Nea escribe), así
 * que el negocio cuya llave se usa es el del ámbito de la credencial, no el
 * que diga una cabecera. La respuesta del proveedor pasa tal cual.
 */
const RUTAS_LLM_PERMITIDAS = new Set(["chat/completions"]);

export async function POST(req: Request, { params }: { params: Promise<{ ruta: string[] }> }) {
  const g = await requireBrain(req);
  if (!g.ok) return g.response;

  const ruta = (await params).ruta.join("/");
  if (!RUTAS_LLM_PERMITIDAS.has(ruta)) {
    return apiError(404, "not_found", "Ruta no disponible");
  }
  const r = await pensarPorElCerebro({
    organizationId: g.ambito.organizationId,
    ruta,
    cuerpoCrudo: await req.text(),
    contentType: req.headers.get("content-type"),
    soloOrganizacion: true,
  });
  if (!r.ok) return apiError(r.status, r.code, r.message);
  return new Response(r.cuerpo, { status: r.status, headers: { "Content-Type": r.contentType } });
}
