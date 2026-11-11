import { conNegocio } from "@/lib/db/contexto";
import { requireBot } from "@/server/bot/auth";

/**
 * 075 (D15 de Aliantis) — Toda ruta de `/api/bot/*`: autentica el negocio
 * (`requireBot`, las seis reglas del contrato 067) y corre la ruta dentro de
 * él, con RLS. La ruta puede volver a llamar `requireBot(req)`: le devuelve lo
 * mismo, sin contar otra vez.
 */
export function rutaDelCerebro<A extends unknown[]>(
  ruta: (req: Request, ...resto: A) => Promise<Response>
): (req: Request, ...resto: A) => Promise<Response> {
  return async (req: Request, ...resto: A) => {
    const auth = await requireBot(req);
    if (auth instanceof Response) return auth;
    return conNegocio(auth.organizationId, () => ruta(req, ...resto));
  };
}
