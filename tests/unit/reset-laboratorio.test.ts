import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 079 (T2, N3 de Aliantis) — `POST /api/bot/reset` solo vale en una
 * conversación del Laboratorio. Fuera de prueba: 409 sin tocar nada.
 */
const h = vi.hoisted(() => ({
  lecturas: [] as unknown[][],
  escrituras: [] as unknown[],
  movimientos: [] as unknown[],
  eventos: [] as unknown[],
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const lectura: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "limit", "orderBy"]) lectura[m] = () => lectura;
  (lectura as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    resolve(h.lecturas.shift() ?? []);
  const db = {
    select: () => lectura,
    update: () => ({
      set: (valores: unknown) => ({
        where: async () => {
          h.escrituras.push(valores);
        },
      }),
    }),
  };
  return { ...actual, getDb: () => db };
});
vi.mock("@/server/bot/auth", () => ({ requireBot: async () => ({ organizationId: "org_1" }) }));
vi.mock("@/server/bot/ruta", () => ({ rutaDelCerebro: (fn: unknown) => fn }));
vi.mock("@/server/events/bus", () => ({
  publish: (_org: string, e: unknown) => {
    h.eventos.push(e);
  },
}));
vi.mock("@/server/leads/stage-history", () => ({
  moveLeadToStage: async (input: unknown) => {
    h.movimientos.push(input);
    return { ok: true, changed: true };
  },
}));

import { POST } from "@/app/api/bot/reset/route";

const reiniciar = () =>
  (POST as (r: Request) => Promise<Response>)(
    new Request("http://x/api/bot/reset", {
      method: "POST",
      body: JSON.stringify({ conversationId: "cv_1" }),
    })
  );

beforeEach(() => {
  h.lecturas = [];
  h.escrituras = [];
  h.movimientos = [];
  h.eventos = [];
});

describe("079 — reset solo en el Laboratorio", () => {
  it("conversación real: 409 solo_laboratorio y no toca IA, traspaso, etapa ni evento", async () => {
    h.lecturas.push([{ id: "cv_1", contactId: "ct_1", isTest: false }]);
    const r = await reiniciar();
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe("solo_laboratorio");
    expect(h.escrituras).toEqual([]);
    expect(h.movimientos).toEqual([]);
    expect(h.eventos).toEqual([]);
  });

  it("conversación de prueba: 200, IA encendida, sin traspaso y lead a la primera etapa", async () => {
    h.lecturas.push(
      [{ id: "cv_1", contactId: "ct_1", isTest: true }],
      [
        { id: "st_2", position: 1 },
        { id: "st_1", position: 0 },
      ],
      [{ id: "ld_1" }]
    );
    const r = await reiniciar();
    expect(r.status).toBe(200);
    expect(h.escrituras).toEqual([
      expect.objectContaining({ aiEnabled: true, handoffAt: null, handoffReason: null }),
    ]);
    expect(h.movimientos).toEqual([
      expect.objectContaining({ leadId: "ld_1", toStageId: "st_1", source: "sistema" }),
    ]);
    expect(h.eventos).toHaveLength(1);
  });

  it("no existe o es de otro negocio: 404 antes que 409, sin escribir", async () => {
    h.lecturas.push([]);
    const r = await reiniciar();
    expect(r.status).toBe(404);
    expect(h.escrituras).toEqual([]);
  });
});
