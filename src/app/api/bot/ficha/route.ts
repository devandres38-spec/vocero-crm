import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { requireBot } from "@/server/bot/auth";
import { rutaDelCerebro } from "@/server/bot/ruta";
import { escribirFichaDelCerebro, validarFichaDelCerebro } from "@/server/bot/ficha-del-cerebro";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  conversationId: z.string().min(1),
  // 078 (D12): la lista blanca se valida abajo, para distinguir una clave
  // ajena (`clave_no_permitida`) de un tipo equivocado (`invalid_body`).
  ficha: z.record(z.string(), z.unknown()),
});

/**
 * Ficha de calificación del lead, escrita por el cerebro.
 * Merge campo a campo contra lo que ya había; `null` explícito borra la clave.
 * Devuelve la ficha COMPLETA resultante, no solo el parche, para que el bot no
 * tenga que llevar su propia copia sincronizada.
 *
 * 078 (D12 de Aliantis) — Solo las claves de la lista blanca
 * (`FICHA_DEL_CEREBRO`): otra da 422 `clave_no_permitida`. Nunca con una
 * persona atendiendo (409 `ai_paused`), solo con la herramienta `ficha`
 * (409 `herramienta_apagada`) y nunca en el Laboratorio (200 `prueba: true`).
 */
async function putSinNegocio(req: Request) {
  const auth = await requireBot(req);
  if (auth instanceof Response) return auth;

  const { organizationId } = auth;

  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const valida = validarFichaDelCerebro(body.data.ficha);
  if (!valida.ok) return apiError(422, valida.code, valida.message);

  const res = await escribirFichaDelCerebro({
    organizationId,
    conversationId: body.data.conversationId,
    ficha: valida.ficha,
  });
  if (!res.ok) return apiError(res.status, res.code, res.message);
  return Response.json("prueba" in res ? { prueba: true } : { ficha: res.ficha });
}

// 075 — Autentica el negocio y corre la ruta dentro de él (RLS).
export const PUT = rutaDelCerebro(putSinNegocio);
