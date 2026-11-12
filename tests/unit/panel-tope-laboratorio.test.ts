import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 080 (T5, D20) — `PUT /api/admin/negocios/:id/laboratorio`: solo con la
 * guarda del panel (superadmin con segundo factor, mismo origen), tope de 0 a
 * 20 (422 fuera), 404 si el negocio no existe.
 */
const h = vi.hoisted(() => ({
  estado: { tipo: "ok" } as Record<string, unknown>,
  llamadas: [] as { id: string; tope: number }[],
  existe: true,
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));
vi.mock("@/server/panel/guard", () => ({
  estadoDelPanel: async () => h.estado,
}));
vi.mock("@/lib/db/contexto", () => ({
  comoPanel: (_u: string, fn: () => unknown) => fn(),
}));
vi.mock("@/server/panel/datos", () => ({
  topeLaboratorioDesdeElPanel: async (id: string, tope: number) => {
    h.llamadas.push({ id, tope });
    if (!h.existe) throw Object.assign(new Error("negocio inexistente"), { code: "P0002" });
    return tope;
  },
}));

import { PUT } from "@/app/api/admin/negocios/[id]/laboratorio/route";

const ORIGEN = "http://crm.test";
const cambiar = (cuerpo: unknown, origen: string | null = ORIGEN) =>
  PUT(
    new Request(`${ORIGEN}/api/admin/negocios/org_1/laboratorio`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...(origen ? { origin: origen } : {}) },
      body: JSON.stringify(cuerpo),
    }),
    { params: Promise.resolve({ id: "org_1" }) }
  );

beforeEach(() => {
  h.estado = {
    tipo: "ok",
    superadmin: { userId: "usr_andres", nombre: "Andres", correo: "a@aliantis.co" },
  };
  h.llamadas = [];
  h.existe = true;
});

describe("080 — el tope del Laboratorio desde el panel", () => {
  it("cambia el tope y lo devuelve", async () => {
    const r = await cambiar({ tope: 5 });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ tope: 5 });
    expect(h.llamadas).toEqual([{ id: "org_1", tope: 5 }]);
  });

  it("0 y 20 son válidos (0 apaga)", async () => {
    expect((await cambiar({ tope: 0 })).status).toBe(200);
    expect((await cambiar({ tope: 20 })).status).toBe(200);
  });

  it("fuera de 0 a 20, o no entero → 422 sin tocar la base", async () => {
    for (const tope of [-1, 21, 2.5, "3"]) {
      expect((await cambiar({ tope })).status).toBe(422);
    }
    expect(h.llamadas).toEqual([]);
  });

  it("un negocio que no existe → 404", async () => {
    h.existe = false;
    const r = await cambiar({ tope: 3 });
    expect(r.status).toBe(404);
  });

  it("una cuenta de negocio (no superadmin) → 404, como si el panel no existiera", async () => {
    h.estado = { tipo: "no_es" };
    expect((await cambiar({ tope: 3 })).status).toBe(404);
    expect(h.llamadas).toEqual([]);
  });

  it("sin segundo factor → 403; sin sesión → 401", async () => {
    h.estado = { tipo: "sin_segundo_factor" };
    expect((await cambiar({ tope: 3 })).status).toBe(403);
    h.estado = { tipo: "sin_sesion" };
    expect((await cambiar({ tope: 3 })).status).toBe(401);
    expect(h.llamadas).toEqual([]);
  });

  it("desde otro origen → 403", async () => {
    expect((await cambiar({ tope: 3 }, "https://malo.example")).status).toBe(403);
    expect(h.llamadas).toEqual([]);
  });
});
