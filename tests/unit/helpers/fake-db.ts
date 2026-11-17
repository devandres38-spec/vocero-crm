/**
 * 069 — Una base falsa mínima para servicios de plataforma: cada SELECT
 * responde lo que se haya encolado para SU tabla (en orden), y cada INSERT,
 * UPDATE y DELETE queda registrado. No evalúa condiciones: la prueba decide
 * qué devuelve cada consulta y comprueba qué se escribió.
 */

export type Escritura = {
  op: "insert" | "update" | "delete";
  tabla: unknown;
  valores: Record<string, unknown>;
};

export function crearFakeDb() {
  const respuestas = new Map<unknown, unknown[][]>();
  const escrituras: Escritura[] = [];

  const siguiente = (tabla: unknown) => respuestas.get(tabla)?.shift() ?? [];

  const select = () => {
    let tabla: unknown;
    const b: Record<string, unknown> = {
      from(t: unknown) {
        tabla = t;
        return b;
      },
      innerJoin: () => b,
      leftJoin: () => b,
      where: () => b,
      orderBy: () => b,
      groupBy: () => b,
      for: () => b,
      limit: () => Promise.resolve(siguiente(tabla)),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(siguiente(tabla)).then(res, rej),
    };
    return b;
  };

  const db = {
    select,
    insert: (tabla: unknown) => ({
      values: (valores: Record<string, unknown> | Record<string, unknown>[]) => {
        const filas = Array.isArray(valores) ? valores : [valores];
        for (const v of filas) escrituras.push({ op: "insert", tabla, valores: v });
        return Object.assign(Promise.resolve(), {
          onConflictDoNothing: () =>
            Object.assign(Promise.resolve(), { returning: () => Promise.resolve(filas.map(() => ({}))) }),
          returning: () => Promise.resolve(filas),
        });
      },
    }),
    update: (tabla: unknown) => ({
      set: (valores: Record<string, unknown>) => ({
        where: () => {
          escrituras.push({ op: "update", tabla, valores });
          return Object.assign(Promise.resolve(), {
            returning: () => Promise.resolve(siguiente(`update:${String((tabla as { _?: unknown })?._ ?? "")}`)),
          });
        },
      }),
    }),
    delete: (tabla: unknown) => ({
      where: () => {
        escrituras.push({ op: "delete", tabla, valores: {} });
        return Object.assign(Promise.resolve(), { returning: () => Promise.resolve([{}]) });
      },
    }),
    execute: () => Promise.resolve(),
    transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(db),
  };

  return {
    db,
    escrituras,
    responder(tabla: unknown, filas: unknown[]) {
      const cola = respuestas.get(tabla) ?? [];
      cola.push(filas);
      respuestas.set(tabla, cola);
    },
    de(tabla: unknown, op?: Escritura["op"]) {
      return escrituras.filter((e) => e.tabla === tabla && (!op || e.op === op));
    },
    reiniciar() {
      respuestas.clear();
      escrituras.length = 0;
    },
  };
}

export type FakeDb = ReturnType<typeof crearFakeDb>;
