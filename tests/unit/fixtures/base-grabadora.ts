import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

/**
 * 070 — Una base simulada que GRABA cada operación de Drizzle (select,
 * insert, update, delete) con su tabla, sus valores y su WHERE ya convertido a
 * SQL de verdad (PgDialect). Las filas de cada `select` y cada `returning` se
 * encolan por tabla. Sirve para afirmar qué se borra y con qué filtro.
 */
export type Operacion = {
  op: "select" | "insert" | "update" | "delete" | "execute";
  tabla: unknown;
  valores?: unknown;
  where?: { sql: string; params: unknown[] };
};

export function baseGrabadora(opciones: { candado?: () => boolean } = {}) {
  const ops: Operacion[] = [];
  const respuestas = new Map<unknown, unknown[][]>();
  const responder = (tabla: unknown, filas: unknown[]) => {
    const cola = respuestas.get(tabla) ?? [];
    cola.push(filas);
    respuestas.set(tabla, cola);
  };
  const siguiente = (tabla: unknown) => respuestas.get(tabla)?.shift() ?? [];

  function cadena(op: Operacion) {
    ops.push(op);
    const c: Record<string, unknown> = {};
    const resolver = () => Promise.resolve(siguiente(op.tabla));
    for (const m of [
      "innerJoin",
      "leftJoin",
      "orderBy",
      "for",
      "onConflictDoNothing",
      "onConflictDoUpdate",
    ]) {
      c[m] = () => c;
    }
    c.from = (tabla: unknown) => {
      op.tabla = tabla;
      return c;
    };
    c.where = (w: SQL | undefined) => {
      if (w) op.where = new PgDialect().sqlToQuery(w);
      return c;
    };
    c.values = (v: unknown) => {
      op.valores = v;
      return c;
    };
    c.set = (v: unknown) => {
      op.valores = v;
      return c;
    };
    // `limit` y `returning` siguen encadenables (`.limit().for()`) y se
    // resuelven al esperar la cadena.
    c.limit = () => c;
    c.returning = () => c;
    c.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      resolver().then(ok, ko);
    return c;
  }

  const db = {
    select: () => cadena({ op: "select", tabla: null }),
    selectDistinct: () => cadena({ op: "select", tabla: null }),
    insert: (tabla: unknown) => cadena({ op: "insert", tabla }),
    update: (tabla: unknown) => cadena({ op: "update", tabla }),
    delete: (tabla: unknown) => cadena({ op: "delete", tabla }),
    transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(db),
    // 072 — SQL crudo (el candado por negocio): se graba y responde `ok`.
    execute: async (q: SQL) => {
      ops.push({ op: "execute", tabla: null, where: new PgDialect().sqlToQuery(q) });
      return [{ ok: opciones.candado ? opciones.candado() : true }];
    },
  };
  return { db, ops, responder };
}
