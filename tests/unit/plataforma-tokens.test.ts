import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/lib/db";
import type { FakeDb } from "./helpers/fake-db";

/** 069 (D14, FR-018) — Tokens personales `alp_…` y la guardia con Bearer. */

const h = vi.hoisted(() => ({
  fake: null as FakeDb | null,
  esSuperAdmin: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("@/lib/db", async (original) => {
  const { crearFakeDb } = await import("./helpers/fake-db");
  h.fake = crearFakeDb();
  return { ...(await original<typeof import("@/lib/db")>()), getDb: () => h.fake!.db };
});
vi.mock("@/server/tenant/consultas", () => ({ esSuperAdmin: h.esSuperAdmin }));
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession: h.getSession } }) }));
vi.mock("@/server/channels/enabled", async (original) => ({
  ...(await original<typeof import("@/server/channels/enabled")>()),
  isChannelEnabled: (c: string) => c === "whatsapp",
}));

import { requirePlataforma } from "@/server/platform/guardia";
import { crearToken, hashTokenApi, tokenDeHeaders, verificarToken } from "@/server/platform/tokens";
import { GET as catalogGET } from "@/app/api/platform/catalog/route";
import { POST as tokensPOST } from "@/app/api/platform/tokens/route";

const fake = () => h.fake!;
const ahora = new Date("2026-11-17T12:00:00Z");
const filaToken = (over: Record<string, unknown> = {}) => ({
  id: "pat_1",
  userId: "u_ops",
  scopes: ["read"],
  expiresAt: null,
  revokedAt: null,
  lastUsedAt: null,
  ...over,
});
const conBearer = (token: string, url = "https://aliantis.co/api/platform/organizations") =>
  new Request(url, { headers: { authorization: `Bearer ${token}` } });
const TOKEN = `alp_${"x".repeat(43)}`;

beforeEach(() => {
  fake().reiniciar();
  h.esSuperAdmin.mockResolvedValue(true);
  h.getSession.mockResolvedValue(null);
  vi.stubEnv("TENANCY", "multi");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("069 — crear un token", () => {
  it("se devuelve una vez; en la base solo el hash y los últimos 4", async () => {
    const r = await crearToken("u_ops", { name: "Claude", scopes: ["provision", "read", "read"] });
    expect(r.token).toMatch(/^alp_[\w-]{43}$/);
    const [fila] = fake().de(schema.platformApiToken, "insert");
    expect(fila?.valores).toMatchObject({
      userId: "u_ops",
      name: "Claude",
      tokenHash: hashTokenApi(r.token),
      last4: r.token.slice(-4),
      scopes: ["provision", "read"],
    });
    expect(JSON.stringify(fake().escrituras.map((e) => e.valores))).not.toContain(r.token);
    expect(fake().de(schema.platformAuditLog)[0]?.valores.action).toBe("token_creado");
  });

  it("solo un Bearer con prefijo alp_ cuenta como token de plataforma", () => {
    expect(tokenDeHeaders(new Headers({ authorization: `Bearer ${TOKEN}` }))).toBe(TOKEN);
    expect(tokenDeHeaders(new Headers({ authorization: "Bearer sk-or-otra-cosa-larga" }))).toBeNull();
    expect(tokenDeHeaders(new Headers())).toBeNull();
  });
});

describe("069 — verificar un token", () => {
  it("válido → alcances, y marca el último uso", async () => {
    fake().responder(schema.platformApiToken, [filaToken({ scopes: ["read", "provision"] })]);
    const v = await verificarToken(TOKEN, null, ahora);
    expect(v?.userId).toBe("u_ops");
    expect([...(v?.scopes ?? [])]).toEqual(["read", "provision"]);
    expect(fake().de(schema.platformApiToken, "update")[0]?.valores).toEqual({ lastUsedAt: ahora });
  });

  it.each([
    [{ revokedAt: new Date("2026-11-01") }, "revocado"],
    [{ expiresAt: new Date("2026-11-10") }, "vencido"],
  ])("%j → rechazado y auditado (%s)", async (over, motivo) => {
    fake().responder(schema.platformApiToken, [filaToken(over)]);
    expect(await verificarToken(TOKEN, null, ahora)).toBeNull();
    expect(fake().de(schema.platformAuditLog)[0]?.valores).toMatchObject({
      action: "token_rechazado",
      detail: { motivo },
    });
  });

  it("su dueño ya no es Super-Admin → rechazado", async () => {
    h.esSuperAdmin.mockResolvedValue(false);
    fake().responder(schema.platformApiToken, [filaToken()]);
    expect(await verificarToken(TOKEN, null, ahora)).toBeNull();
  });

  it("desconocido → null sin auditoría (no hay actor)", async () => {
    expect(await verificarToken(TOKEN, null, ahora)).toBeNull();
    expect(fake().escrituras).toEqual([]);
  });
});

describe("069 — la guardia con Bearer", () => {
  it("`single`: 404 aunque el token sea válido", async () => {
    vi.stubEnv("TENANCY", "single");
    const g = await requirePlataforma(conBearer(TOKEN));
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.response.status).toBe(404);
  });

  it("token inválido → 401 (quien lo manda ya sabe que la API existe)", async () => {
    const g = await requirePlataforma(conBearer(TOKEN));
    expect(!g.ok && g.response.status).toBe(401);
  });

  it("token `read` no puede aprovisionar → 403", async () => {
    fake().responder(schema.platformApiToken, [filaToken({ scopes: ["read"] })]);
    const g = await requirePlataforma(conBearer(TOKEN), { scope: "provision" });
    expect(!g.ok && g.response.status).toBe(403);
  });

  it("token válido → actor con su vía y su token", async () => {
    fake().responder(schema.platformApiToken, [filaToken({ scopes: ["read", "provision"] })]);
    const g = await requirePlataforma(conBearer(TOKEN), { scope: "provision", via: "mcp" });
    expect(g.ok && g.actor).toMatchObject({ userId: "u_ops", via: "mcp", tokenId: "pat_1" });
  });

  it("un token no gestiona tokens (solo con sesión)", async () => {
    fake().responder(schema.platformApiToken, [filaToken({ scopes: ["read", "provision"] })]);
    const res = await tokensPOST(
      new Request("https://aliantis.co/api/platform/tokens", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ name: "x", scopes: ["read"] }),
      })
    );
    expect(res.status).toBe(404);
    expect(fake().de(schema.platformApiToken, "insert")).toEqual([]);
  });

  it("el catálogo responde con un token `read` e incluye el JSON Schema", async () => {
    fake().responder(schema.platformApiToken, [filaToken()]);
    const res = await catalogGET(conBearer(TOKEN, "https://aliantis.co/api/platform/catalog"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { blueprintVersion: number; schema: { type: string }; agent: { roles: unknown[] } };
    expect(body.blueprintVersion).toBe(1);
    expect(body.schema.type).toBe("object");
    expect(body.agent.roles.length).toBeGreaterThan(0);
  });
});
