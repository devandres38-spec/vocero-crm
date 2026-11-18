import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/lib/db";
import type { FakeDb } from "./helpers/fake-db";

/**
 * 069 (US9, D15, SC-005) — El servidor MCP: puerta, protocolo, herramientas
 * permitidas y, sobre todo, que es un adaptador: el mismo Blueprint por REST
 * y por MCP escribe exactamente lo mismo.
 */

const h = vi.hoisted(() => ({ fake: null as FakeDb | null, esSuperAdmin: vi.fn() }));

vi.mock("@/lib/db", async (original) => {
  const { crearFakeDb } = await import("./helpers/fake-db");
  h.fake = crearFakeDb();
  return { ...(await original<typeof import("@/lib/db")>()), getDb: () => h.fake!.db };
});
vi.mock("@/server/tenant/consultas", () => ({ esSuperAdmin: h.esSuperAdmin }));
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession: async () => null } }) }));

import { POST as mcpPOST, GET as mcpGET } from "@/app/api/platform/mcp/route";
import { POST as restCrear } from "@/app/api/platform/organizations/route";

const fake = () => h.fake!;
const TOKEN = `alp_${"x".repeat(43)}`;
const filaToken = (scopes: string[]) => ({
  id: "pat_1",
  userId: "u_ops",
  scopes,
  expiresAt: null,
  revokedAt: null,
  lastUsedAt: new Date(), // reciente: no se reescribe el último uso
});

function rpc(body: unknown, token: string | null = TOKEN, extra: Record<string, string> = {}) {
  return new Request("https://aliantis.co/api/platform/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      // Auditoría H-08: structuredContent solo con la versión que lo trae.
      "mcp-protocol-version": "2025-06-18",
      ...extra,
    },
    body: JSON.stringify(body),
  });
}
const llamar = (name: string, args: unknown, id = 1) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: args },
});

beforeEach(() => {
  fake().reiniciar();
  h.esSuperAdmin.mockResolvedValue(true);
  vi.stubEnv("TENANCY", "multi");
  vi.stubEnv("PLATFORM_MCP", "on");
  vi.stubEnv("PLATFORM_BASE_DOMAIN", "aliantis.co");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("069 — puerta del MCP", () => {
  it("apagado por defecto → 404", async () => {
    vi.stubEnv("PLATFORM_MCP", "");
    expect((await mcpPOST(rpc({ jsonrpc: "2.0", id: 1, method: "ping" }))).status).toBe(404);
    expect((await mcpGET()).status).toBe(404);
  });

  it("en `single`, aunque la bandera esté encendida → 404", async () => {
    vi.stubEnv("TENANCY", "single");
    expect((await mcpPOST(rpc({ jsonrpc: "2.0", id: 1, method: "ping" }))).status).toBe(404);
  });

  it("sin token, o con uno desconocido → 401 con WWW-Authenticate", async () => {
    const sin = await mcpPOST(rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, null));
    expect(sin.status).toBe(401);
    expect(sin.headers.get("www-authenticate")).toMatch(/Bearer/);
    expect((await mcpPOST(rpc({ jsonrpc: "2.0", id: 1, method: "ping" }))).status).toBe(401);
  });

  it("un Origin ajeno (DNS rebinding) → 403", async () => {
    const res = await mcpPOST(rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, TOKEN, { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });

  it("GET (sin SSE) → 405", async () => {
    expect((await mcpGET()).status).toBe(405);
  });
});

describe("069 — protocolo", () => {
  it("initialize negocia la versión y anuncia herramientas", async () => {
    fake().responder(schema.platformApiToken, [filaToken(["read"])]);
    const res = await mcpPOST(rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }));
    const body = (await res.json()) as { result: { protocolVersion: string; capabilities: { tools: unknown } } };
    expect(body.result.protocolVersion).toBe("2025-03-26");
    expect(body.result.capabilities.tools).toBeDefined();
  });

  it("una notificación → 202 sin cuerpo", async () => {
    fake().responder(schema.platformApiToken, [filaToken(["read"])]);
    const res = await mcpPOST(rpc({ jsonrpc: "2.0", method: "notifications/initialized" }));
    expect(res.status).toBe(202);
  });

  it("método desconocido → error JSON-RPC -32601", async () => {
    fake().responder(schema.platformApiToken, [filaToken(["read"])]);
    const body = (await (await mcpPOST(rpc({ jsonrpc: "2.0", id: 7, method: "resources/list" }))).json()) as {
      id: number;
      error: { code: number };
    };
    expect(body).toMatchObject({ id: 7, error: { code: -32601 } });
  });

  it("tools/list: exactamente estas herramientas, ninguna sobre datos personales, soporte, borrado ni tokens", async () => {
    fake().responder(schema.platformApiToken, [filaToken(["read"])]);
    const body = (await (await mcpPOST(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }))).json()) as {
      result: { tools: { name: string; inputSchema: { type: string } }[] };
    };
    const nombres = body.result.tools.map((t) => t.name).sort();
    expect(nombres).toEqual(
      [
        "apply_blueprint",
        "create_owner_invitation",
        "get_blueprint",
        "get_catalog",
        "get_organization",
        "list_audit_log",
        "list_organizations",
        "plan_blueprint",
        "reactivate_organization",
        "revoke_invitation",
        "suspend_organization",
      ].sort()
    );
    expect(nombres.join(" ")).not.toMatch(/conversation|contact|message|support|soporte|delete|token/);
    for (const t of body.result.tools) expect(t.inputSchema.type).toBe("object");
  });

  it("un token `read` no aplica: resultado con isError y auditado", async () => {
    fake().responder(schema.platformApiToken, [filaToken(["read"])]);
    const body = (await (
      await mcpPOST(rpc(llamar("apply_blueprint", { blueprint: { version: 1 } })))
    ).json()) as { result: { isError: boolean; structuredContent: { error: { code: string } } } };
    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.error.code).toBe("alcance_insuficiente");
    expect(fake().de(schema.platformAuditLog)[0]?.valores).toMatchObject({ action: "acceso_denegado", via: "mcp" });
    expect(fake().de(schema.organization, "insert")).toEqual([]);
  });

  it("un Blueprint inválido vuelve como isError con la ruta exacta (la IA corrige)", async () => {
    fake().responder(schema.platformApiToken, [filaToken(["read", "provision"])]);
    const body = (await (
      await mcpPOST(rpc(llamar("plan_blueprint", { blueprint: { version: 1, brand: { accent: "azul" } } })))
    ).json()) as { result: { isError: boolean; structuredContent: { error: { code: string; issues: unknown } } } };
    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.error).toEqual({
      code: "blueprint_invalido",
      issues: [{ path: "brand.accent", message: "color_invalido" }],
    });
  });
});

describe("069 — equivalencia REST ↔ MCP (SC-005)", () => {
  const blueprint = {
    version: 1,
    organization: { slug: "ferreteria-rojas", name: "Ferretería Rojas" },
    region: { country: "CO", locale: "es-CO", timezone: "America/Bogota" },
    brand: { accent: "#0d3b9e", currency: "COP" },
    modules: { agenda: false },
    owner: { email: "dueno@ferreteria.co" },
  };

  /** Lo escrito, sin lo que es aleatorio por diseño (ids, hash del token, fechas) ni la vía. */
  function normalizado() {
    const aleatorio = /^(org|mem|stg|agp|inv|aud|kb|cal|sop|pat)_[a-z0-9]+$/;
    const limpiar = (v: unknown): unknown => {
      if (typeof v === "string") return aleatorio.test(v) ? v.split("_")[0] + "_*" : v;
      if (v instanceof Date) return "<fecha>";
      if (Array.isArray(v)) return v.map(limpiar);
      if (v && typeof v === "object") {
        return Object.fromEntries(
          Object.entries(v as Record<string, unknown>)
            .filter(([k]) => !["tokenHash", "via", "expiresAt"].includes(k))
            .map(([k, x]) => [k, limpiar(x)])
        );
      }
      return v;
    };
    return fake().escrituras.map((e) => ({ op: e.op, tabla: e.tabla, valores: limpiar(e.valores) }));
  }

  it("el mismo Blueprint produce las mismas escrituras y la misma auditoría (salvo la vía)", async () => {
    fake().responder(schema.platformApiToken, [filaToken(["read", "provision"])]);
    const rest = await restCrear(
      new Request("https://aliantis.co/api/platform/organizations", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify(blueprint),
      })
    );
    expect(rest.status).toBe(201);
    const porRest = normalizado();
    const viasRest = fake().de(schema.platformAuditLog).map((e) => e.valores.via);
    const resultadoRest = (await rest.json()) as { sections: unknown };

    fake().reiniciar();
    fake().responder(schema.platformApiToken, [filaToken(["read", "provision"])]);
    const mcp = await mcpPOST(rpc(llamar("apply_blueprint", { blueprint })));
    const body = (await mcp.json()) as { result: { isError: boolean; structuredContent: { sections: unknown } } };
    expect(body.result.isError).toBe(false);
    const porMcp = normalizado();
    const viasMcp = fake().de(schema.platformAuditLog).map((e) => e.valores.via);

    expect(porMcp).toEqual(porRest);
    expect(body.result.structuredContent.sections).toEqual(resultadoRest.sections);
    expect(new Set(viasRest)).toEqual(new Set(["api"]));
    expect(new Set(viasMcp)).toEqual(new Set(["mcp"]));
  });
});
