import { comoSistema } from "@/lib/db/contexto";

/**
 * 075 (D4) — La entrada de un webhook: llega sin negocio. Corre en modo
 * sistema (no ve ninguna tabla de negocio) hasta que el negocio sale de la
 * función de solo ids (`vocero_negocio_por_canal`) y la firma se verifica;
 * desde ahí, `recibirEvento` guarda y procesa dentro de ese negocio.
 */
export function webhookEntrante<A extends unknown[]>(
  ruta: (...args: A) => Promise<Response>
): (...args: A) => Promise<Response> {
  return (...args: A) => comoSistema("webhook-entrante", () => ruta(...args));
}
