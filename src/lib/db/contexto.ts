import { AsyncLocalStorage } from "node:async_hooks";

/**
 * 075 (D15 de Aliantis) — En qué negocio corre cada consulta.
 *
 * El negocio vive en un `AsyncLocalStorage`, y el cliente de la base
 * (`cliente-rls.ts`) lo fija en Postgres dentro de cada transacción con
 * `set_config('app.organization_id', <id>, true)`. Las políticas RLS de la
 * migración 0033 filtran por ese valor.
 *
 * - `conNegocio(org, fn)`: todo lo que corra dentro ve y escribe SOLO en `org`.
 * - `comoSistema(motivo, fn)`: sin negocio. Por RLS no ve ninguna tabla de
 *   negocio; sirve para las cuentas de Better Auth y las funciones de solo ids
 *   (`vocero_*`). Si se entra desde un negocio, se recuerda: desde ahí no se
 *   puede pasar a OTRO negocio.
 * - `trabajoDeFondo(motivo, fn)`: el punto de entrada de un proceso de fondo
 *   (worker, arranque, comando). Empieza de cero, sin heredar el negocio de
 *   quien creó el temporizador, y desde ahí puede entrar a cualquier negocio.
 *
 * Una consulta sin nada de esto lanza `ConsultaSinNegocio` (respuesta 1 de
 * Andres): con RLS devolvería vacío en silencio y escondería el error.
 */

export type Contexto =
  | { tipo: "negocio"; organizationId: string }
  | { tipo: "sistema"; motivo: string; desde: string | null };

const g = globalThis as unknown as { __voceroContextoDb?: AsyncLocalStorage<Contexto> };

// En globalThis: en dev los módulos se evalúan más de una vez y todas las
// copias deben compartir el mismo contexto.
function almacen(): AsyncLocalStorage<Contexto> {
  if (!g.__voceroContextoDb) g.__voceroContextoDb = new AsyncLocalStorage<Contexto>();
  return g.__voceroContextoDb;
}

/** Los ids de negocio de Vocero (`org_…`), como `assertOrganizationId` del cerebro. */
const ID_DE_NEGOCIO = /^[A-Za-z0-9_-]{1,128}$/;

export class ConsultaSinNegocio extends Error {
  constructor(detalle = "") {
    super(
      "Consulta a la base sin negocio: envuélvela en conNegocio(), comoSistema() o trabajoDeFondo()" +
        (detalle ? ` (${detalle})` : "")
    );
    this.name = "ConsultaSinNegocio";
  }
}

export class NegocioCruzado extends Error {
  constructor() {
    super("Se intentó entrar a un negocio desde otro: cada negocio en su propio contexto");
    this.name = "NegocioCruzado";
  }
}

export function validarNegocio(organizationId: string): void {
  if (typeof organizationId !== "string" || !ID_DE_NEGOCIO.test(organizationId)) {
    throw new Error("organizationId inválido");
  }
}

export function contextoActual(): Contexto | undefined {
  return almacen().getStore();
}

/** El negocio de la consulta en curso, o `null` (sistema o sin contexto). */
export function negocioActual(): string | null {
  const c = contextoActual();
  return c?.tipo === "negocio" ? c.organizationId : null;
}

export function conNegocio<T>(organizationId: string, fn: () => Promise<T>): Promise<T> {
  validarNegocio(organizationId);
  const actual = contextoActual();
  const desde =
    actual?.tipo === "negocio" ? actual.organizationId : actual?.tipo === "sistema" ? actual.desde : null;
  if (desde !== null && desde !== organizationId) {
    return Promise.reject(new NegocioCruzado());
  }
  return almacen().run({ tipo: "negocio", organizationId }, fn);
}

export function comoSistema<T>(motivo: string, fn: () => Promise<T>): Promise<T> {
  const actual = contextoActual();
  const desde =
    actual?.tipo === "negocio" ? actual.organizationId : actual?.tipo === "sistema" ? actual.desde : null;
  return almacen().run({ tipo: "sistema", motivo, desde }, fn);
}

export function trabajoDeFondo<T>(motivo: string, fn: () => Promise<T>): Promise<T> {
  return almacen().run({ tipo: "sistema", motivo, desde: null }, fn);
}
