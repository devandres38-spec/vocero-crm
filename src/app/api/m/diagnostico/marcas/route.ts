import { apiError } from "@/lib/api";
import { withModulo } from "@/server/modulos/guardas";
import { marcasDeConversacion } from "@/modulos/diagnostico/consultas";

export const dynamic = "force-dynamic";

/**
 * 072-B — `GET /api/m/diagnostico/marcas?conversationId=…`: cuántas marcas
 * dejó el cerebro en esa conversación (la sección de la ficha lateral). Sin
 * el módulo, 404 sin cuerpo; una conversación de otro negocio cuenta 0.
 */
export const GET = withModulo("diagnostico", async (session, req: Request) => {
  const conversationId = new URL(req.url).searchParams.get("conversationId");
  if (!conversationId || conversationId.length > 128) {
    return apiError(422, "invalid", "Falta conversationId");
  }
  return Response.json(await marcasDeConversacion(session.organizationId, conversationId));
});
