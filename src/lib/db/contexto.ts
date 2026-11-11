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
 * - `comoPanel(superadminId, fn)` (076, D16): el panel de Andres. Cada
 *   consulta corre con el rol `vocero_panel`, que no puede leer NINGUNA tabla:
 *   solo las funciones `vocero_panel_*`, que devuelven agregados. Desde ahí no
 *   se puede entrar a un negocio ni al modo sistema (`PanelSinSalida`).
 *
 * Una consulta sin nada de esto lanza `ConsultaSinNegocio` (respuesta 1 de
 * Andres): con RLS devolvería vacío en silencio y escondería el error.
 */

export type Contexto =
  | { tipo: "negocio"; organizationId: string }
  | { tipo: "sistema"; motivo: string; desde: string | null }
  | { tipo: "panel"; superadminId: string };

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

export class PanelSinSalida extends Error {
  constructor() {
    super("Desde el panel de Andres no se entra a un negocio ni al modo sistema: solo agregados (D16)");
    this.name = "PanelSinSalida";
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

export function conNegocio<T>(organizationId: string, fn: () => PromiseLike<T>): Promise<T> {
  validarNegocio(organizationId);
  const actual = contextoActual();
  if (actual?.tipo === "panel") return Promise.reject(new PanelSinSalida());
  const desde =
    actual?.tipo === "negocio" ? actual.organizationId : actual?.tipo === "sistema" ? actual.desde : null;
  if (desde !== null && desde !== organizationId) {
    return Promise.reject(new NegocioCruzado());
  }
  return almacen().run({ tipo: "negocio", organizationId }, () => dentro(fn));
}

export function comoSistema<T>(motivo: string, fn: () => PromiseLike<T>): Promise<T> {
  const actual = contextoActual();
  if (actual?.tipo === "panel") return Promise.reject(new PanelSinSalida());
  const desde =
    actual?.tipo === "negocio" ? actual.organizationId : actual?.tipo === "sistema" ? actual.desde : null;
  return almacen().run({ tipo: "sistema", motivo, desde }, () => dentro(fn));
}

export function trabajoDeFondo<T>(motivo: string, fn: () => PromiseLike<T>): Promise<T> {
  if (contextoActual()?.tipo === "panel") return Promise.reject(new PanelSinSalida());
  return almacen().run({ tipo: "sistema", motivo, desde: null }, () => dentro(fn));
}

/**
 * 076 — El panel de Andres. Solo se entra desde fuera de todo contexto (la
 * ruta o la página del panel, tras `requireSuperadmin`): nunca desde un
 * negocio ni desde el modo sistema.
 */
export function comoPanel<T>(superadminId: string, fn: () => PromiseLike<T>): Promise<T> {
  validarNegocio(superadminId);
  const actual = contextoActual();
  if (actual && !(actual.tipo === "panel" && actual.superadminId === superadminId)) {
    return Promise.reject(new PanelSinSalida());
  }
  return almacen().run({ tipo: "panel", superadminId }, () => dentro(fn));
}

/**
 * Espera el resultado DENTRO del contexto. Las consultas de Drizzle son
 * perezosas: `conNegocio(org, () => db.select()…)` devuelve la consulta sin
 * ejecutar, y si se esperara fuera correría sin negocio (lo encontró
 * `e2e-rls` contra Postgres real).
 */
async function dentro<T>(fn: () => PromiseLike<T>): Promise<T> {
  return await fn();
}
