import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** 069 (FR-006, D7) — La puerta de la plataforma y la suspensión. */

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  esSuperAdmin: vi.fn(),
  listar: vi.fn(),
  requireSession: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession: mocks.getSession } }) }));
vi.mock("@/server/tenant/consultas", () => ({ esSuperAdmin: mocks.esSuperAdmin }));
vi.mock("@/server/platform/organizaciones", () => ({ listarOrganizaciones: mocks.listar }));
vi.mock("@/lib/auth/session", async (original) => ({
  ...(await original<typeof import("@/lib/auth/session")>()),
  requireSession: mocks.requireSession,
}));

import { GET } from "@/app/api/platform/organizations/route";
import { withAuth } from "@/lib/api";
import { OrganizacionSuspendidaError } from "@/lib/auth/session";

const req = () => new Request("https://aliantis.co/api/platform/organizations");

beforeEach(() => {
  mocks.getSession.mockResolvedValue({ user: { id: "u1" } });
  mocks.listar.mockResolvedValue([]);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("069 — /api/platform/* solo para Super-Admin en modo plataforma", () => {
  it("`single`: 404 aunque sea Super-Admin", async () => {
    mocks.esSuperAdmin.mockResolvedValue(true);
    const res = await GET(req());
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
    expect(mocks.listar).not.toHaveBeenCalled();
  });

  it("`multi` sin sesión: 404 (no 401: la superficie no se anuncia)", async () => {
    vi.stubEnv("TENANCY", "multi");
    mocks.getSession.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(404);
  });

  it("`multi` con sesión de un owner cualquiera: 404", async () => {
    vi.stubEnv("TENANCY", "multi");
    mocks.esSuperAdmin.mockResolvedValue(false);
    expect((await GET(req())).status).toBe(404);
    expect(mocks.listar).not.toHaveBeenCalled();
  });

  it("`multi` y Super-Admin: 200", async () => {
    vi.stubEnv("TENANCY", "multi");
    mocks.esSuperAdmin.mockResolvedValue(true);
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ organizations: [] });
  });
});

describe("069 — organización suspendida", () => {
  it("la API de sus miembros responde 403 `organizacion_suspendida`", async () => {
    mocks.requireSession.mockRejectedValue(new OrganizacionSuspendidaError());
    const handler = vi.fn();
    const res = await withAuth(handler)();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "organizacion_suspendida" } });
    expect(handler).not.toHaveBeenCalled();
  });

  it("envío y despacho la consultan; la ingesta NO (no se pierde ningún mensaje)", () => {
    const leer = (f: string) => readFileSync(f, "utf8");
    expect(leer("src/server/inbox/send.ts")).toMatch(/organizacionSuspendida\(organizationId\)/);
    expect(leer("src/server/dispatch/encolar.ts")).toMatch(/organizacionSuspendida\(organizationId\)/);
    expect(leer("src/server/inbox/ingest.ts")).not.toMatch(/organizacionSuspendida/);
  });
});
