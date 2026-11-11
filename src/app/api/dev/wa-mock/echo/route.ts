import { conNegocio, trabajoDeFondo } from "@/lib/db/contexto";
import { z } from "zod";
import { mockGuard } from "@/lib/dev-guard";
import { apiError, parseBody } from "@/lib/api";
import { getCredentialsByPhoneNumberId } from "@/server/whatsapp/credentials";
import { negocioPorCanal } from "@/server/db-sistema";
import {
  buildEchoPayload,
  deliverToWebhook,
} from "@/server/dev/wa-mock-inbound";

export const dynamic = "force-dynamic";

/**
 * 008 — Simula un echo de coexistence: el dueño respondió A MANO desde la app
 * de WhatsApp Business del teléfono. Entrega el payload firmado al webhook
 * real (misma ruta que Meta). Solo en el entorno de pruebas (dev-guard).
 */
const schema = z.object({
  phoneNumberId: z.string().min(1),
  /** wa_id del lead destinatario. */
  to: z.string().min(5),
  type: z.string().optional(),
  text: z.string().optional(),
  waMessageId: z.string().optional(),
  timestamp: z.number().optional(),
  mediaId: z.string().optional(),
  mimeType: z.string().optional(),
  caption: z.string().optional(),
  filename: z.string().optional(),
  location: z.record(z.string(), z.unknown()).optional(),
  useMessagesKey: z.boolean().optional(),
});

async function postSinNegocio(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;

  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;

  // 075 — El negocio del número (solo el id) y sus credenciales, dentro de él.
  const org = await negocioPorCanal("phone_number_id", body.data.phoneNumberId);
  const creds = org
    ? await conNegocio(org, () => getCredentialsByPhoneNumberId(body.data.phoneNumberId))
    : null;
  const payload = buildEchoPayload({
    ...body.data,
    wabaId: creds?.wabaId ?? "WABA-MOCK",
  });
  const res = await deliverToWebhook(payload);
  if (!res.ok) {
    return apiError(502, "webhook_error", `El webhook respondió ${res.status}`);
  }
  return Response.json({ delivered: true });
}

// 075 — Mock de desarrollo: proceso de fondo que entra a cada negocio que toca.
export const POST = (req: Request) => trabajoDeFondo("dev-mock", () => postSinNegocio(req));
