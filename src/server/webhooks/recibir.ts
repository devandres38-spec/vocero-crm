import { after } from "next/server";
import { conNegocio, trabajoDeFondo } from "@/lib/db/contexto";
import { guardarEvento, type FuenteWebhook } from "./eventos";
import { resolverOrganizacion } from "./organizacion";
import { procesarFuente } from "./procesar";
import { procesarEvento } from "./worker";

/**
 * 047 — Lo que hace cada ruta de webhook tras validar el token y la firma.
 *
 * 1. Resuelve la organización. Si no hay —nadie conectó ese número o esa
 *    cuenta—, procesa como antes: la ingesta lo descarta con su aviso.
 * 2. Guarda el evento. Si la base no responde, devuelve 503: la fuente
 *    reintenta (Meta durante días) en vez de dar el mensaje por entregado.
 * 3. Responde 200 y lo procesa enseguida, fuera de la ruta. Si falla, queda
 *    pendiente y el barrido lo reintenta.
 *
 * Nunca deja pasar una excepción: la ruta siempre recibe una respuesta.
 *
 * 073 — Las rutas de Meta ya resolvieron la organización al verificar la firma
 * de ese negocio (`firma.ts`): la pasan en `resuelta` y se usa esa, la misma
 * cuyo secreto validó la entrega.
 */
export async function recibirEvento(
  fuente: FuenteWebhook,
  payload: unknown,
  rawBody: string,
  etiqueta: string,
  resuelta?: { organizationId: string | null }
): Promise<Response> {
  let organizationId: string | null;
  let evento: { id: string; nuevo: boolean };
  try {
    organizationId = resuelta
      ? resuelta.organizationId
      : await resolverOrganizacion(fuente, payload);
    if (!organizationId) {
      // 075 — Sin negocio: en modo sistema el RLS no le deja ver nada, así
      // que se descarta como siempre (ningún negocio tiene esa cuenta).
      after(async () => {
        try {
          await trabajoDeFondo("webhook-sin-negocio", () => procesarFuente(fuente, payload));
        } catch (err) {
          console.error(`[${etiqueta}] error procesando un evento sin organización:`, resumen(err));
        }
      });
      return Response.json({ received: true });
    }
    const org = organizationId;
    // 075 — Se guarda dentro de su negocio (RLS).
    evento = await conNegocio(org, () =>
      guardarEvento({ organizationId: org, fuente, payload, rawBody })
    );
  } catch (err) {
    console.error(
      `[${etiqueta}] no se pudo guardar el evento; se responde 503 para que la fuente reintente:`,
      resumen(err)
    );
    return Response.json({ received: false }, { status: 503 });
  }

  // Una entrega repetida ya está guardada: la procesa (o la procesó) su fila.
  if (evento.nuevo) after(() => procesarEvento(evento.id, organizationId));
  return Response.json({ received: true });
}

function resumen(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
