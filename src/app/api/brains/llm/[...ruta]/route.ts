import { apiError } from "@/lib/api";
import { leerCuerpoAcotado, withBrain } from "@/server/brains/http";
import { pensarPorElCerebro } from "@/server/bot/llm-proxy";
import { ajustesDelNegocio } from "@/server/ajustes-bot";
import { dispatchIdDeCabecera } from "@/server/llm-usage";

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
 *
 * Auditoría 070 (A-8): el cuerpo se lee con tope (25 MB: una nota de voz de
 * 16 MB en base64 cabe), solo JSON, y sin `stream: true` (el proxy no
 * transmite por partes: lo retendría entero en memoria).
 */
const RUTAS_LLM_PERMITIDAS = new Set(["chat/completions"]);
const MAX_CUERPO_LLM = 25 * 1024 * 1024;

export const POST = withBrain<{ params: Promise<{ ruta: string[] }> }>(async (req, ambito, ctx) => {
  const ruta = (await ctx.params).ruta.join("/");
  if (!RUTAS_LLM_PERMITIDAS.has(ruta)) {
    return apiError(404, "not_found", "Ruta no disponible");
  }
  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return apiError(415, "content_type", "El cuerpo debe ser application/json");
  }
  const cuerpo = await leerCuerpoAcotado(req, MAX_CUERPO_LLM);
  if (cuerpo === null) {
    return apiError(413, "payload_too_large", "El cuerpo excede 25 MB");
  }
  let datos: unknown;
  try {
    datos = JSON.parse(cuerpo);
  } catch {
    return apiError(422, "invalid_body", "El cuerpo debe ser JSON válido");
  }
  if (datos && typeof datos === "object" && (datos as { stream?: unknown }).stream === true) {
    return apiError(400, "stream_no_soportado", "Este proxy no transmite por partes: usa stream=false");
  }
  const r = await pensarPorElCerebro({
    organizationId: ambito.organizationId,
    ruta,
    cuerpoCrudo: cuerpo,
    contentType: "application/json",
    soloOrganizacion: true,
    // 073-B (decisión #8): el respaldo que fija la plataforma.
    modeloDeRespaldo: (await ajustesDelNegocio(ambito.organizationId)).bot.fallbackModel,
    // 074 (D9, E9): un ensayo de «Probar mi agente» se cuenta aparte.
    ...(ambito.ensayo ? { fuente: "ensayo" as const } : {}),
    dispatchId: ambito.ensayo ? null : dispatchIdDeCabecera(req.headers.get("x-vocero-dispatch")),
  });
  if (!r.ok) return apiError(r.status, r.code, r.message);
  return new Response(r.cuerpo, { status: r.status, headers: { "Content-Type": r.contentType } });
});
