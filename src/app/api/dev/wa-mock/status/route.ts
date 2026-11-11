import { conNegocio, trabajoDeFondo } from "@/lib/db/contexto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { mockGuard } from "@/lib/dev-guard";
import { apiError, parseBody } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";
import { todasLasOrganizaciones } from "@/server/db-sistema";
import {
  buildStatusPayload,
  deliverToWebhook,
} from "@/server/dev/wa-mock-inbound";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  waMessageId: z.string().min(1),
  status: z.enum(["sent", "delivered", "read", "failed"]),
  /** Reproduce el `errors[]` que Meta adjunta a los `failed`. */
  errorCode: z.number().int().optional(),
  errorMessage: z.string().optional(),
});

async function postSinNegocio(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;

  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  // Resolver el número desde el mensaje (el payload real lleva metadata).
  // 075 — Solo desarrollo: se busca el mensaje negocio por negocio (RLS).
  let organizationId: string | null = null;
  for (const org of await todasLasOrganizaciones()) {
    const [fila] = await conNegocio(org, () =>
      getDb()
        .select({ organizationId: schema.message.organizationId })
        .from(schema.message)
        .where(eq(schema.message.waMessageId, body.data.waMessageId))
        .limit(1)
    );
    if (fila) {
      organizationId = fila.organizationId;
      break;
    }
  }
  if (!organizationId) return apiError(404, "not_found", "Mensaje no encontrado");
  const org = organizationId;

  const creds = await conNegocio(org, () => getCredentialsByOrg(org));
  if (!creds) return apiError(409, "not_connected", "Sin número conectado");

  const payload = buildStatusPayload({
    wabaId: creds.wabaId,
    phoneNumberId: creds.phoneNumberId,
    waMessageId: body.data.waMessageId,
    status: body.data.status,
    errorCode: body.data.errorCode,
    errorMessage: body.data.errorMessage,
  });
  const res = await deliverToWebhook(payload);
  return res.ok
    ? Response.json({ delivered: true })
    : apiError(502, "webhook_error", `El webhook respondió ${res.status}`);
}

// 075 — Mock de desarrollo: proceso de fondo que entra a cada negocio que toca.
export const POST = (req: Request) => trabajoDeFondo("dev-mock", () => postSinNegocio(req));
