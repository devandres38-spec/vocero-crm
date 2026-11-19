import { notFound, redirect } from "next/navigation";
import { withAuth } from "@/lib/api";
import {
  contextoActual,
  destinoSinOrganizacion,
  getSessionOrNull,
  type SessionContext,
} from "@/lib/auth/session";
import { modulosDe } from "@/server/modulos/consulta";

/**
 * 072-B (D16, FR-041) — Las puertas de las superficies de un módulo. Toda
 * carpeta `src/app/(app)/m/<clave>/` tiene un `layout.tsx` con
 * `exigirModulo("<clave>")`, y toda ruta de `src/app/api/m/<clave>/` se
 * envuelve con `withModulo("<clave>", …)` (prueba-guardarraíl en
 * `tests/unit/modulos-072b.test.ts`).
 *
 * Un módulo apagado es indistinguible de uno que no existe: página 404 y API
 * 404 sin cuerpo, igual que una organización ajena (`SinAccesoError`).
 */

type ConModulos = Pick<SessionContext, "modulos"> | null | undefined;

/** Puro: ¿el módulo está encendido para esta sesión (techo ∧ organización)? */
export function moduloActivo(s: ConModulos, clave: string): boolean {
  return modulosDe(s).modules.includes(clave);
}

/** Para un `layout.tsx` de `/m/<clave>`: devuelve la sesión o corta con 404. */
export async function exigirModulo(clave: string): Promise<SessionContext> {
  const session = await getSessionOrNull();
  if (!session) redirect(destinoSinOrganizacion(await contextoActual()));
  if (!moduloActivo(session, clave)) notFound();
  return session;
}

/** `withAuth` + el módulo encendido; si no, 404 limpio. */
export function withModulo<Args extends unknown[]>(
  clave: string,
  handler: (session: SessionContext, ...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return withAuth(async (session: SessionContext, ...args: Args) => {
    if (!moduloActivo(session, clave)) return new Response(null, { status: 404 });
    return handler(session, ...args);
  });
}
