import { describe, expect, it, vi } from "vitest";

/**
 * 074 — Contra la instancia REAL de Better Auth (no un mock del gancho):
 * toda ruta que el plugin `organization` registra responde 404, y el
 * registro público, 403. La base es un objeto vacío: si una petición llegara
 * a tocarla, la prueba fallaría por eso, que es justo lo que no debe pasar.
 */
vi.mock("@/lib/db", async (orig) => ({
  ...(await orig<typeof import("@/lib/db")>()),
  getDb: () => ({}),
}));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    APP_BASE_URL: "http://localhost:3000",
    BETTER_AUTH_SECRET: "s".repeat(48),
  }),
}));

import { getAuth } from "@/lib/auth";

type Endpoint = { path?: string; options?: { method?: string | string[] } };

function rutasDelPlugin(): { path: string; method: string }[] {
  return Object.values(getAuth().api as unknown as Record<string, Endpoint>)
    .filter(
      (e) => typeof e?.path === "string" && e.path.startsWith("/organization")
    )
    .map((e) => {
      const m = e.options?.method;
      const method = Array.isArray(m)
        ? m.includes("POST")
          ? "POST"
          : m[0]!
        : (m ?? "POST");
      return { path: e.path!, method: method === "*" ? "POST" : method };
    });
}

async function pedir(path: string, method: string) {
  return getAuth().handler(
    new Request(`http://localhost:3000/api/auth${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `10.0.0.${path.length}`,
      },
      ...(method === "GET"
        ? {}
        : {
            body: JSON.stringify({
              name: "X",
              slug: "x",
              organizationId: "org_a",
            }),
          }),
    })
  );
}

describe("074 — el plugin `organization` cerrado", () => {
  it("el plugin registra sus rutas (si no, esta prueba no probaría nada)", () => {
    const rutas = rutasDelPlugin().map((r) => r.path);
    expect(rutas).toContain("/organization/create");
    expect(rutas).toContain("/organization/delete");
    expect(rutas.length).toBeGreaterThan(20);
  });

  it("TODAS responden 404, una por una", async () => {
    const abiertas: string[] = [];
    for (const { path, method } of rutasDelPlugin()) {
      const r = await pedir(path, method);
      if (r.status !== 404) abiertas.push(`${method} ${path} → ${r.status}`);
    }
    expect(abiertas).toEqual([]);
  });

  it("el registro público responde 403", async () => {
    const r = await getAuth().handler(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "10.0.1.1",
        },
        body: JSON.stringify({
          email: "x@y.co",
          password: "password-123",
          name: "X",
        }),
      })
    );
    expect(r.status).toBe(403);
  });
});
