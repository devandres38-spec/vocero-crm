import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 075 (D4) — Los puntos de entrada fijan el negocio: `withAuth` (sesión) y
 * `rutaDelCerebro` (cerebro). La ruta corre dentro de él; sin eso, cada
 * consulta lanzaría `ConsultaSinNegocio`.
 */
const h = vi.hoisted(() => ({
  sesion: { userId: "u1", organizationId: "org_a", role: "owner" },
  autenticaciones: 0,
}));
vi.mock("@/lib/auth/session", () => ({
  requireSession: async () => h.sesion,
  UnauthorizedError: class extends Error {},
}));
vi.mock("@/server/bot/organizaciones", () => ({
  organizacionExiste: async () => {
    h.autenticaciones++;
    return true;
  },
  hastaDosOrganizaciones: async () => ["org_b"],
}));

import { withAuth } from "@/lib/api";
import { negocioActual } from "@/lib/db/contexto";
import { requireBot } from "@/server/bot/auth";
import { credencialDerivada } from "@/server/brains/credencial";
import { rutaDelCerebro } from "@/server/bot/ruta";

const KEY = "k".repeat(32);

beforeEach(() => {
  h.autenticaciones = 0;
  vi.stubEnv("BOT_API_KEY", KEY);
});

describe("075 — withAuth", () => {
  it("la ruta corre dentro del negocio de la sesión", async () => {
    const ruta = withAuth(async () => Response.json({ negocio: negocioActual() }));
    const r = await ruta();
    expect(await r.json()).toEqual({ negocio: "org_a" });
  });
});

describe("075 — rutaDelCerebro", () => {
  const pedir = () =>
    new Request("http://x/api/bot/context", {
      headers: { "x-vocero-organization": "org_b", "x-api-key": credencialDerivada(KEY, "org_b") },
    });

  it("autentica y corre la ruta dentro del negocio del cerebro", async () => {
    const ruta = rutaDelCerebro(async () => Response.json({ negocio: negocioActual() }));
    expect(await (await ruta(pedir())).json()).toEqual({ negocio: "org_b" });
  });

  it("la ruta puede volver a llamar requireBot: mismo resultado, sin autenticar otra vez", async () => {
    const ruta = rutaDelCerebro(async (req: Request) => {
      const auth = await requireBot(req);
      return Response.json(auth instanceof Response ? { error: true } : auth);
    });
    expect(await (await ruta(pedir())).json()).toEqual({ organizationId: "org_b" });
    expect(h.autenticaciones).toBe(1);
  });

  it("sin credencial: 401 y la ruta no corre", async () => {
    const ruta = vi.fn(async () => new Response("no"));
    const r = await rutaDelCerebro(ruta)(new Request("http://x/api/bot/context"));
    expect(r.status).toBe(401);
    expect(ruta).not.toHaveBeenCalled();
  });
});
