import { apiError, parseBody } from "@/lib/api";
import { requireBot } from "@/server/bot/auth";
import { rutaDelCerebro } from "@/server/bot/ruta";
import {
  consentimientoSchema,
  registrarConsentimiento,
} from "@/server/consent";

export const dynamic = "force-dynamic";

/**
 * 070 (067 §3) — El cerebro registra lo que la persona respondió al aviso de
 * privacidad (o al de marketing). Solo agrega: no hay edición ni borrado por
 * esta API. Vale también en el Laboratorio.
 *
 * 201 `{ id, createdAt }` · 404 `not_found` (la conversación no es del
 * negocio) · 422 `invalid_body`.
 */
async function postSinNegocio(req: Request) {
  const auth = await requireBot(req);
  if (auth instanceof Response) return auth;

  const { organizationId } = auth;

  const body = await parseBody(req, consentimientoSchema);
  if (!body.ok) return body.response;

  const r = await registrarConsentimiento(organizationId, body.data);
  if (!r.ok) return apiError(404, "not_found", "Conversación no encontrada");
  return Response.json(
    { id: r.id, createdAt: r.createdAt.toISOString() },
    { status: 201 },
  );
}

// 075 — Autentica el negocio y corre la ruta dentro de él (RLS).
export const POST = rutaDelCerebro(postSinNegocio);
