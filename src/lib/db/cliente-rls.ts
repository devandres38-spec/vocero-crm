import type { Sql } from "postgres";
import { ConsultaSinNegocio, contextoActual } from "./contexto";

/**
 * 075 (D15 de Aliantis) — El cliente que ve Drizzle: el de `postgres`, con el
 * negocio fijado DEBAJO de Drizzle, sin tocar ninguna de las consultas.
 *
 * Drizzle solo usa del cliente `unsafe(query, params)` (sola o con
 * `.values()`), `begin(fn)` y, dentro de una transacción, el `tx` real.
 *
 * Con un negocio en el contexto (`conNegocio`):
 * - cada consulta suelta corre como `begin` → `set_config(…, true)` → la
 *   consulta → `commit`; las dos sentencias salen juntas (pipeline);
 * - cada `db.transaction` empieza con el mismo `set_config`.
 *
 * `is_local = true`: el valor muere con la transacción, así que una conexión
 * vuelve al pool SIN negocio y nunca lo pasa a la petición siguiente.
 *
 * En modo sistema, la consulta va tal cual (por RLS no ve tablas de negocio).
 * Sin contexto: `ConsultaSinNegocio` en modo «lanzar»; en «avisar» (solo
 * mientras se migran los puntos de entrada, spec 075 T3 a T7) se registra y
 * pasa.
 */

export type ModoSinContexto = "avisar" | "lanzar";

/** 075 — «lanzar» siempre (respuesta 1 de Andres); «avisar» solo existió de T3 a T7. */
export const MODO_SIN_CONTEXTO: ModoSinContexto = "lanzar";

export const FIJAR_NEGOCIO = "select set_config('app.organization_id', $1, false)";

type Opciones = { modo?: ModoSinContexto; avisar?: (detalle: string) => void };

const avisados = new Set<string>();
function avisarUnaVez(detalle: string): void {
  if (avisados.has(detalle) || avisados.size > 200) return;
  avisados.add(detalle);
  console.warn(`[db] consulta sin negocio (075, modo avisar): ${detalle}`);
}

/** La primera línea del SQL, para el registro: nunca los parámetros. */
function resumen(query: string): string {
  return query.replace(/\s+/g, " ").slice(0, 80);
}

type Sentencia = { values(): unknown; execute(): unknown } & PromiseLike<unknown>;
type Tx = Sql & { unsafe(q: string, p?: unknown[], o?: unknown): Sentencia };

export function clienteConRls(sql: Sql, opciones: Opciones = {}): Sql {
  const modo = opciones.modo ?? MODO_SIN_CONTEXTO;
  const avisar = opciones.avisar ?? avisarUnaVez;

  /** `null`: sin negocio (sistema, o sin contexto en modo avisar). */
  function negocioOFallar(query: string): string | null {
    const ctx = contextoActual();
    if (ctx?.tipo === "negocio") return ctx.organizationId;
    if (ctx?.tipo === "sistema") return null;
    if (modo === "lanzar") throw new ConsultaSinNegocio(resumen(query));
    avisar(resumen(query));
    return null;
  }

  function unsafe(query: string, params?: unknown[], opts?: unknown) {
    let org: string | null;
    try {
      org = negocioOFallar(query);
    } catch (err) {
      const fallo = Promise.reject(err);
      fallo.catch(() => {});
      return { then: fallo.then.bind(fallo), values: () => fallo };
    }
    const directa = () => (sql.unsafe as Tx["unsafe"])(query, params as never, opts);
    if (org === null) return directa();
    const correr = (valores: boolean) =>
      sql.begin(async (tx) => {
        const t = tx as unknown as Tx;
        // Pipeline: las dos salen juntas, en este orden, por la misma conexión.
        const fijar = t.unsafe(FIJAR_NEGOCIO, [org]).execute() as Promise<unknown>;
        const q = t.unsafe(query, params as never, opts);
        const resultado = (valores ? q.values() : q) as Sentencia;
        const [, filas] = await Promise.all([fijar, resultado.execute() as Promise<unknown>]);
        return filas;
      });
    return {
      then: (ok?: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => correr(false).then(ok, ko),
      values: () => correr(true),
    };
  }

  function begin(...args: unknown[]) {
    const fn = args[args.length - 1] as (tx: Sql) => unknown;
    const config = args.length > 1 ? [args[0] as string] : [];
    let org: string | null;
    try {
      org = negocioOFallar("begin");
    } catch (err) {
      return Promise.reject(err);
    }
    if (org === null) return (sql.begin as (...a: unknown[]) => unknown)(...config, fn);
    return (sql.begin as (...a: unknown[]) => unknown)(...config, async (tx: Sql) => {
      await (tx as unknown as Tx).unsafe(FIJAR_NEGOCIO, [org]);
      return fn(tx);
    });
  }

  return new Proxy(sql, {
    get(objetivo, prop, receptor) {
      if (prop === "unsafe") return unsafe;
      if (prop === "begin") return begin;
      return Reflect.get(objetivo, prop, receptor);
    },
  });
}
