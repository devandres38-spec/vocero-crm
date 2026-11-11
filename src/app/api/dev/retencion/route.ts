import { trabajoDeFondo } from "@/lib/db/contexto";
import { z } from "zod";
import { parseBody } from "@/lib/api";
import { mockGuard } from "@/lib/dev-guard";
import { aplicarRetencion } from "@/server/retencion/aplicar";

export const dynamic = "force-dynamic";

/**
 * 072 — Solo con mocks: corre una pasada de retención ahora (o con el `ahora`
 * que mande el arnés), sin esperar las 24 horas del worker. Devuelve solo
 * conteos por negocio. 404 en producción.
 */
async function postSinNegocio(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const body = await parseBody(
    req,
    z.object({ ahora: z.string().datetime().optional() })
  );
  if (!body.ok) return body.response;
  const ahora = body.data.ahora ? new Date(body.data.ahora) : new Date();
  const negocios = await aplicarRetencion(ahora);
  // null: el worker tenía una pasada en curso; el arnés reintenta.
  if (!negocios) return Response.json({ enCurso: true }, { status: 409 });
  return Response.json({ negocios });
}

// 075 — Mock de desarrollo: proceso de fondo que entra a cada negocio que toca.
export const POST = (req: Request) => trabajoDeFondo("dev-mock", () => postSinNegocio(req));
