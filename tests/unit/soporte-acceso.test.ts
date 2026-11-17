import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionContext } from "@/lib/auth/session";

/** 069 (US5, FR-011) — Acceso de soporte en dos niveles, auditado por petición. */

const h = vi.hoisted(() => ({ session: vi.fn(), auditar: vi.fn(), getSession: vi.fn(), esSuperAdmin: vi.fn() }));

vi.mock("@/lib/auth/session", async (original) => ({
  ...(await original<typeof import("@/lib/auth/session")>()),
  requireSession: h.session,
}));
vi.mock("@/server/platform/auditoria", () => ({ auditar: h.auditar }));
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession: h.getSession } }) }));
vi.mock("@/server/tenant/consultas", () => ({ esSuperAdmin: h.esSuperAdmin }));

import { withAuth } from "@/lib/api";
import { SinAccesoError } from "@/lib/auth/session";
import { puedeConfigurar } from "@/lib/auth/roles";
import { solicitudSoporteSchema } from "@/server/platform/soporte";
import { POST as abrirSoporte } from "@/app/api/platform/organizations/[idOrSlug]/support/route";

const soporte = (level: "lectura" | "configuracion"): SessionContext => ({
  userId: "u_ops",
  organizationId: "org_A",
  role: "soporte",
  via: "soporte",
  grant: { id: "sop_1", level, expiresAt: new Date(Date.now() + 3_600_000) },
});
const req = (method: string, path: string, body?: unknown) =>
  new Request(`https://negocio-a.aliantis.co${path}`, {
    method,
    ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
  });
const ok = vi.fn(async (_s: SessionContext, _req: Request) => Response.json({ ok: true }));

beforeEach(() => {
  h.auditar.mockResolvedValue(undefined);
  ok.mockClear();
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("069 — nivel `lectura`", () => {
  it("GET pasa y queda auditado con método y ruta", async () => {
    h.session.mockResolvedValue(soporte("lectura"));
    const res = await withAuth(ok)(req("GET", "/api/conversations"));
    expect(res.status).toBe(200);
    expect(h.auditar).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "soporte_peticion",
        organizationId: "org_A",
        detail: expect.objectContaining({ level: "lectura", method: "GET", path: "/api/conversations" }),
      })
    );
  });

  it("cualquier escritura → 403 `solo_lectura`, aunque la ruta admita configuración", async () => {
    h.session.mockResolvedValue(soporte("lectura"));
    const res = await withAuth(ok, { soporte: "configuracion" })(req("PUT", "/api/agent/profile", { name: "x" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "solo_lectura" } });
    expect(ok).not.toHaveBeenCalled();
    expect(h.auditar).toHaveBeenCalledWith(expect.objectContaining({ action: "acceso_denegado" }));
  });
});

describe("069 — nivel `configuracion`", () => {
  it("una ruta que lo declara: la mutación pasa y se auditan los CAMPOS, no los valores", async () => {
    h.session.mockResolvedValue(soporte("configuracion"));
    const res = await withAuth(ok, { soporte: "configuracion" })(
      req("PUT", "/api/agent/profile", { greeting: "Hola secreto", name: "Sofía" })
    );
    expect(res.status).toBe(200);
    const entrada = h.auditar.mock.calls[0]?.[0];
    expect(entrada.detail).toMatchObject({ level: "configuracion", method: "PUT", changedKeys: ["greeting", "name"] });
    expect(JSON.stringify(entrada)).not.toContain("Hola secreto");
  });

  it("una ruta que NO lo declara (enviar un mensaje) → 403 `fuera_de_alcance`", async () => {
    h.session.mockResolvedValue(soporte("configuracion"));
    const res = await withAuth(ok)(req("POST", "/api/conversations/cv_1/messages", { text: "hola" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "fuera_de_alcance" } });
    expect(ok).not.toHaveBeenCalled();
  });

  it.each(["/api/settings/ai", "/api/settings/whatsapp", "/api/settings/team", "/api/settings/instagram"])(
    "credenciales y equipo: ni leerlas (%s)",
    async (ruta) => {
      h.session.mockResolvedValue(soporte("configuracion"));
      const res = await withAuth(ok)(req("GET", ruta));
      expect(res.status).toBe(403);
      expect(ok).not.toHaveBeenCalled();
    }
  );

  it("en la UI cuenta como quien configura; `lectura` no", () => {
    expect(puedeConfigurar(soporte("configuracion"))).toBe(true);
    expect(puedeConfigurar(soporte("lectura"))).toBe(false);
    expect(puedeConfigurar({ role: "member" })).toBe(false);
    expect(puedeConfigurar({ role: "owner" })).toBe(true);
  });
});

describe("069 — sin acceso, vencido o revocado", () => {
  it("la API responde 404 vacío (la agencia no sabe ni si hay algo)", async () => {
    h.session.mockRejectedValue(new SinAccesoError());
    const res = await withAuth(ok)(req("GET", "/api/conversations"));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
  });

  it("un miembro normal no pasa por el control de soporte ni se audita", async () => {
    h.session.mockResolvedValue({ userId: "u1", organizationId: "org_A", role: "owner", via: "miembro" });
    await withAuth(ok)(req("POST", "/api/conversations/cv_1/messages", { text: "x" }));
    expect(ok).toHaveBeenCalled();
    expect(h.auditar).not.toHaveBeenCalled();
  });
});

describe("069 — pedir un acceso", () => {
  it.each([
    [{ level: "lectura", reason: "corto", hours: 1 }, "motivo_corto"],
    [{ level: "lectura", reason: "Ticket 123 del cliente", hours: 9 }, "caducidad_maxima_8h"],
    [{ level: "admin", reason: "Ticket 123 del cliente", hours: 1 }, "level"],
  ])("%j → inválido (%s)", (valor, pista) => {
    const r = solicitudSoporteSchema.safeParse(valor);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain(pista);
  });

  it("válido: motivo ≥ 10 y hasta 8 h", () => {
    expect(solicitudSoporteSchema.safeParse({ level: "configuracion", reason: "Ticket 123 del cliente", hours: 8 }).success).toBe(true);
  });

  it("ni un token de API ni el MCP pueden abrir accesos (solo una persona con sesión)", async () => {
    vi.stubEnv("TENANCY", "multi");
    const res = await abrirSoporte(
      new Request("https://aliantis.co/api/platform/organizations/negocio-a/support", {
        method: "POST",
        headers: { authorization: `Bearer alp_${"x".repeat(43)}`, "content-type": "application/json" },
        body: JSON.stringify({ level: "lectura", reason: "Ticket 123 del cliente", hours: 1 }),
      }),
      { params: Promise.resolve({ idOrSlug: "negocio-a" }) }
    );
    expect(res.status).toBe(404);
  });
});
