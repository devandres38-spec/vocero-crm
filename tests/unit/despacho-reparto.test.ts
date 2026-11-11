import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 074 (4.4) — Reparto justo del despacho: la ráfaga de un negocio no deja a
 * los demás detrás. Como N7 en `/api/bot/*`, pero en la cola del despacho.
 */
type Fila = { id: string; organizationId: string };

const h = vi.hoisted(() => ({
  cola: [] as { id: string; organizationId: string }[],
  procesadas: [] as string[],
  enNegocio: [] as (string | null)[],
  grab: null as unknown,
}));

// 075 — El negocio del siguiente sale de la función de solo ids (con el
// reparto); el despacho se toma DENTRO de ese negocio: el más viejo del suyo.
vi.mock("@/server/db-sistema", () => ({
  despachosVencidos: async (_ahora: Date, _limite: number, excluir: readonly string[]) => {
    const f = h.cola.find((x) => !excluir.includes(x.organizationId));
    return f ? [{ id: f.id, organizationId: f.organizationId }] : [];
  },
  negociosConOlvidos: async () => [],
  negociosConAvisos: async () => [],
}));
vi.mock("@/server/dispatch/outbox", async (orig) => ({
  ...(await orig<typeof import("@/server/dispatch/outbox")>()),
  tomarPendientes: async () => {
    h.enNegocio.push(negocioActual());
    const i = h.cola.findIndex((f) => f.organizationId === negocioActual());
    return i < 0 ? [] : h.cola.splice(i, 1);
  },
  descartarDespacho: async (fila: Fila) => {
    h.procesadas.push(fila.organizationId);
  },
  renovarLease: async () => undefined,
}));
vi.mock("@/server/brains/config", () => ({ leerConfigDespacho: () => ({ active: false }) }));
vi.mock("@/server/avisos/avisos", () => ({
  enviarAvisosPendientes: async () => undefined,
  registrarTraspaso: async () => undefined,
}));
vi.mock("@/server/dispatch/olvidos", () => ({ reintentarOlvidos: async () => undefined }));

import { conNegocio, negocioActual } from "@/lib/db/contexto";
import { negociosServidos, POR_NEGOCIO_EN_TANDA, tanda } from "@/server/dispatch/worker";

const filas = (org: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `${org}_${i}`, organizationId: org }));

beforeEach(() => {
  h.cola = [];
  h.procesadas = [];
  h.enNegocio = [];
});

describe("074 — la tanda reparte por negocio", () => {
  it("A con 30 en cola y B con 1 detrás: B sale en la primera tanda, entre los primeros 3", async () => {
    h.cola = [...filas("A", 30), ...filas("B", 1)];
    expect(await tanda()).toBe(10);
    expect(h.procesadas.slice(0, POR_NEGOCIO_EN_TANDA + 1)).toContain("B");
  });

  it("tres negocios con cola: en los primeros 6, dos de cada uno", async () => {
    h.cola = [...filas("A", 5), ...filas("B", 5), ...filas("C", 5)];
    await tanda();
    const primeros = h.procesadas.slice(0, 6);
    for (const org of ["A", "B", "C"]) expect(primeros.filter((o) => o === org)).toHaveLength(2);
  });

  it("solo A tiene cola: toma las 10 (no se pierde capacidad)", async () => {
    h.cola = filas("A", 30);
    expect(await tanda()).toBe(10);
    expect(h.procesadas).toEqual(Array(10).fill("A"));
  });

  it("dentro de un negocio se respeta el orden de llegada", async () => {
    h.cola = [...filas("A", 3), ...filas("B", 1)];
    const orden: string[] = [];
    const original = h.cola.map((f) => f.id);
    await tanda();
    // La cola simulada saca por orden; lo que queda de A sale en su orden.
    for (const id of original) if (!h.cola.some((f) => f.id === id)) orden.push(id);
    expect(orden.filter((id) => id.startsWith("A"))).toEqual(["A_0", "A_1", "A_2"]);
  });

  it("075 — cada despacho se toma dentro de SU negocio", async () => {
    h.cola = [...filas("A", 2), ...filas("B", 2)];
    await tanda();
    expect(h.enNegocio).toEqual(["A", "A", "B", "B"]);
  });

  it("075 — disparada desde dentro de un negocio (temporizador heredado): procesa los demás", async () => {
    h.cola = [...filas("A", 1), ...filas("B", 1)];
    await conNegocio("A", () => tanda());
    expect(h.enNegocio).toEqual(["A", "B"]);
  });

  it("negociosServidos", () => {
    expect(negociosServidos(new Map([["A", 2], ["B", 1]]))).toEqual(["A"]);
    expect(negociosServidos(new Map())).toEqual([]);
  });
});

describe("074 — la consulta real de tomarPendientes", () => {
  it("con negocios ya servidos, el WHERE los deja fuera; sin ellos, no filtra por negocio", async () => {
    const { baseGrabadora } = await import("./fixtures/base-grabadora");
    const g = baseGrabadora();
    vi.doMock("@/lib/db", async () => ({
      ...(await vi.importActual<typeof import("@/lib/db")>("@/lib/db")),
      getDb: () => g.db,
    }));
    vi.resetModules();
    const real = await vi.importActual<typeof import("@/server/dispatch/outbox")>(
      "@/server/dispatch/outbox"
    );
    await real.tomarPendientes(1, new Date(), ["A", "B"]);
    await real.tomarPendientes(1, new Date());
    const [conLista, sinLista] = g.ops.filter((o) => o.op === "select");
    expect(conLista!.where!.sql).toMatch(/"organization_id" not in \(\$\d+, \$\d+\)/);
    expect(conLista!.where!.params).toEqual(expect.arrayContaining(["A", "B"]));
    expect(sinLista!.where!.sql).not.toMatch(/organization_id/);
    vi.doUnmock("@/lib/db");
  });
});
