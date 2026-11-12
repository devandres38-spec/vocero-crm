import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 078 (T4, D18) — El dueño elige en la pantalla de etapas qué evento del
 * agente mueve a cada una: solo etapas abiertas, uno por evento en el negocio
 * (si otra lo tenía, pasa a esta), `null` lo quita.
 */
const h = vi.hoisted(() => ({
  etapa: { kind: "open" } as { kind: string } | null,
  updates: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    withAuth:
      (fn: (s: unknown, req: Request, ctx: unknown) => Promise<Response>) =>
      (req: Request, ctx: unknown) =>
        fn({ organizationId: "org_1", userId: "u_1", role: "owner" }, req, ctx),
  };
});

vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db")>();
  const cadena = (filas: () => unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "limit", "returning"]) c[m] = () => c;
    (c as { then: unknown }).then = (r: (v: unknown) => void) => r(filas());
    return c;
  };
  return {
    ...original,
    getDb: () => ({
      select: () => cadena(() => (h.etapa ? [h.etapa] : [])),
      update: () => ({
        set: (v: Record<string, unknown>) => {
          h.updates.push(v);
          return cadena(() => [{ id: "st_1", ...v }]);
        },
      }),
    }),
  };
});

import { PATCH } from "@/app/api/pipeline/stages/[id]/route";

const patch = (body: Record<string, unknown>) =>
  (PATCH as (r: Request, c: unknown) => Promise<Response>)(
    new Request("http://x/api/pipeline/stages/st_1", {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id: "st_1" }) }
  );

beforeEach(() => {
  h.etapa = { kind: "open" };
  h.updates.length = 0;
});

describe("078 — el mapeo en la pantalla de etapas", () => {
  it("a una etapa abierta: primero se lo quita a la que lo tenía, luego se lo da a esta", async () => {
    const r = await patch({ eventoBot: "pidio_cita" });
    expect(r.status).toBe(200);
    expect(h.updates).toEqual([{ eventoBot: null }, { eventoBot: "pidio_cita" }]);
  });

  it("a una etapa ganada o perdida: 409 etapa_cerrada, sin escribir nada", async () => {
    for (const kind of ["won", "lost"]) {
      h.etapa = { kind };
      const r = await patch({ eventoBot: "primera_respuesta" });
      expect(r.status).toBe(409);
      expect((await r.json()).error.code).toBe("etapa_cerrada");
    }
    expect(h.updates).toEqual([]);
  });

  it("null lo quita, sin tocar otras etapas", async () => {
    await patch({ eventoBot: null });
    expect(h.updates).toEqual([{ eventoBot: null }]);
  });

  it("un evento fuera del catálogo: 422", async () => {
    expect((await patch({ eventoBot: "ganar" })).status).toBe(422);
    expect(h.updates).toEqual([]);
  });

  it("renombrar no toca el mapeo", async () => {
    await patch({ name: "Interesada" });
    expect(h.updates).toEqual([{ name: "Interesada" }]);
  });
});

describe("078 — la pantalla solo ofrece el mapeo en etapas abiertas", () => {
  it("el selector de evento va dentro de `s.kind === \"open\"`", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/components/pipeline/stage-manager.tsx", "utf8");
    const abierta = src.indexOf('{s.kind === "open" && (');
    const selector = src.indexOf("El agente mueve aquí al cliente cuando");
    expect(abierta).toBeGreaterThan(0);
    expect(selector).toBeGreaterThan(abierta);
  });
});
