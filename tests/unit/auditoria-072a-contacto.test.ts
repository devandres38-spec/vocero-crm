import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Auditoría 072-A (A-6) — `PATCH /api/contacts/[id]` devuelve `ignored`
 * cuando el esquema de la ficha descartó un valor; sin descartes, la
 * respuesta es la de siempre (`{ contact }`).
 */
const m = vi.hoisted(() => ({ session: vi.fn(), upsert: vi.fn() }));

vi.mock("@/lib/auth/session", async (original) => ({
  ...(await original<typeof import("@/lib/auth/session")>()),
  requireSession: m.session,
}));
vi.mock("@/server/bot/ficha", async (original) => ({
  ...(await original<typeof import("@/server/bot/ficha")>()),
  upsertFicha: m.upsert,
}));
vi.mock("@/lib/db", async (original) => {
  const fila = { id: "ct_1", organizationId: "org_a" };
  return {
    ...(await original<typeof import("@/lib/db")>()),
    getDb: () => ({
      update: () => ({ set: () => ({ where: () => ({ returning: async () => [fila] }) }) }),
    }),
  };
});
vi.mock("@/server/contacts", async (original) => ({
  ...(await original<typeof import("@/server/contacts")>()),
  serializeContact: (c: { id: string }) => ({ id: c.id }),
}));
vi.mock("@/server/attribution/store", () => ({
  anuncioDelContacto: async () => null,
  repararImagenSiFalta: async () => undefined,
}));

import { PATCH } from "@/app/api/contacts/[id]/route";

const pedir = (body: unknown) =>
  PATCH(
    new Request("http://localhost/api/contacts/ct_1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "ct_1" }) }
  );

beforeEach(() => {
  vi.clearAllMocks();
  m.session.mockResolvedValue({ organizationId: "org_a", role: "owner" });
});

describe("A-6 — PATCH /api/contacts/[id] con la ficha", () => {
  it("devuelve `ignored` cuando el esquema descartó algo", async () => {
    const ignored = [{ key: "num_invitados", reason: "no_es_numero" }];
    m.upsert.mockResolvedValue({ ficha: { ciudad: "Cali" }, ignored });
    const res = await pedir({ ficha: { num_invitados: "muchos", ciudad: "Cali" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ignored).toEqual(ignored);
    expect(body.contact).toEqual({ id: "ct_1" });
    expect(m.upsert).toHaveBeenCalledWith({
      organizationId: "org_a",
      contactId: "ct_1",
      ficha: { num_invitados: "muchos", ciudad: "Cali" },
    });
  });

  it("sin descartes, la respuesta es la de siempre (sin `ignored`)", async () => {
    m.upsert.mockResolvedValue({ ficha: { ciudad: "Cali" } });
    const body = await (await pedir({ ficha: { ciudad: "Cali" } })).json();
    expect(body).toEqual({ contact: { id: "ct_1" } });
  });

  it("sin ficha en el cuerpo, no se toca la ficha ni aparece `ignored`", async () => {
    const body = await (await pedir({ notes: "hola" })).json();
    expect(m.upsert).not.toHaveBeenCalled();
    expect(body).toEqual({ contact: { id: "ct_1" } });
  });
});
