import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizarNumeroDeLista, validarListaDeNumeros } from "@/server/dispatch/solo-numeros";

/**
 * 079 (T6) — «Solo estos números» en el perfil del Agente: la ruta limpia y
 * valida los números, y cambiar el Agente exige `canConfigure` en toda la
 * ruta (403), como `preset`.
 */
const h = vi.hoisted(() => ({
  rol: "owner",
  updates: [] as Record<string, unknown>[],
  perfil: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/db")>();
  const consulta = () => {
    const q = {
      from: () => q,
      where: () => q,
      limit: () => q,
      then: (ok: (v: unknown[]) => unknown) => Promise.resolve(h.perfil ? [h.perfil] : []).then(ok),
    };
    return q;
  };
  return {
    ...real,
    getDb: () => ({
      select: consulta,
      update: () => ({
        set: (v: Record<string, unknown>) => {
          h.updates.push(v);
          const w = { where: () => w, returning: async () => [{ id: "agp_1" }] };
          return w;
        },
      }),
    }),
  };
});
vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  requireSession: async () => ({ userId: "usr_1", organizationId: "org_1", role: h.rol }),
  getSessionOrNull: async () => ({ userId: "usr_1", organizationId: "org_1", role: h.rol }),
}));
vi.mock("@/lib/ai/provider", () => ({
  estadoIaDe: async () => ({ activa: true }),
  mensajeDeEstado: () => null,
}));

import { GET, PUT } from "@/app/api/agent/profile/route";

const guardar = (body: Record<string, unknown>) =>
  PUT(
    new Request("http://crm.test/api/agent/profile", {
      method: "PUT",
      headers: { "content-type": "application/json", origin: "http://crm.test" },
      body: JSON.stringify(body),
    })
  );

beforeEach(() => {
  h.rol = "owner";
  h.updates = [];
  h.perfil = null;
});

describe("079 — limpiar y validar un número", () => {
  it("pegado como venga: quita +, espacios, guiones, puntos y paréntesis", () => {
    expect(normalizarNumeroDeLista("+57 300 111 2233")).toBe("573001112233");
    expect(normalizarNumeroDeLista("+57 (300) 111-22.33")).toBe("573001112233");
  });

  it("aplica normalizeMx: 521… queda 52…", () => {
    expect(normalizarNumeroDeLista("+52 1 55 1234 5678")).toBe("525512345678");
  });

  it("sin código de país, muy largo o con letras: no sirve", () => {
    expect(normalizarNumeroDeLista("3001112233")).toBeNull();
    expect(normalizarNumeroDeLista("1234567890123456")).toBeNull();
    expect(normalizarNumeroDeLista("57300abc2233")).toBeNull();
    expect(normalizarNumeroDeLista("57/3001112233")).toBeNull();
  });

  it("sin repetidos, comparados ya normalizados, y sin renglones vacíos", () => {
    const v = validarListaDeNumeros({
      activo: true,
      numeros: ["+52 1 55 1234 5678", "525512345678", "", "  ", "573001112233"],
    });
    expect(v).toEqual({ ok: true, lista: { activo: true, numeros: ["525512345678", "573001112233"] } });
  });
});

describe("079 — PUT /api/agent/profile con soloNumeros", () => {
  it("guarda la lista limpia y normalizada", async () => {
    const r = await guardar({ soloNumeros: { activo: true, numeros: ["+57 300-111-2233", "5215512345678"] } });
    expect(r.status).toBe(200);
    expect(h.updates[0]).toMatchObject({
      soloNumerosActivo: true,
      soloNumeros: ["573001112233", "525512345678"],
    });
    expect(h.updates[0]).not.toHaveProperty("soloNumeros.activo");
  });

  it("un número inválido: 422 numero_invalido con el número en el mensaje, sin guardar", async () => {
    const r = await guardar({ soloNumeros: { activo: true, numeros: ["573001112233", "300 111 2233"] } });
    expect(r.status).toBe(422);
    const { error } = await r.json();
    expect(error.code).toBe("numero_invalido");
    expect(error.message).toContain("300 111 2233");
    expect(h.updates).toEqual([]);
  });

  it("encenderla vacía: 422 lista_vacia", async () => {
    const r = await guardar({ soloNumeros: { activo: true, numeros: ["", " "] } });
    expect(r.status).toBe(422);
    expect((await r.json()).error.code).toBe("lista_vacia");
    expect(h.updates).toEqual([]);
  });

  it("apagarla vacía sí se puede", async () => {
    const r = await guardar({ soloNumeros: { activo: false, numeros: [] } });
    expect(r.status).toBe(200);
    expect(h.updates[0]).toMatchObject({ soloNumerosActivo: false, soloNumeros: [] });
  });

  it("más de 50: 422", async () => {
    const numeros = Array.from({ length: 51 }, (_, i) => `5730011${String(i).padStart(5, "0")}`);
    expect((await guardar({ soloNumeros: { activo: true, numeros } })).status).toBe(422);
  });

  it("guardar otro campo no toca la lista", async () => {
    await guardar({ name: "Sofi" });
    expect(h.updates[0]).not.toHaveProperty("soloNumerosActivo");
    expect(h.updates[0]).not.toHaveProperty("soloNumeros");
  });
});

describe("079 — canConfigure en toda la ruta", () => {
  it.each([
    ["la lista", { soloNumeros: { activo: true, numeros: ["573001112233"] } }],
    ["el interruptor", { enabled: false }],
    ["el nombre", { name: "Sofi" }],
  ])("un miembro no cambia %s: 403 forbidden", async (_c, body) => {
    h.rol = "member";
    const r = await guardar(body);
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe("forbidden");
    expect(h.updates).toEqual([]);
  });

  it("admin sí", async () => {
    h.rol = "admin";
    expect((await guardar({ name: "Sofi" })).status).toBe(200);
  });
});

describe("079 — GET devuelve la lista", () => {
  it("activo y números", async () => {
    h.perfil = {
      enabled: true,
      name: "Asistente",
      tone: null,
      instructions: null,
      escalationRules: null,
      greeting: null,
      role: "calificador",
      tools: null,
      soloNumerosActivo: true,
      soloNumeros: ["573001112233"],
    };
    const r = await GET();
    expect((await r.json()).profile.soloNumeros).toEqual({ activo: true, numeros: ["573001112233"] });
  });
});
