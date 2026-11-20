import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/lib/db";
import type { FakeDb } from "./helpers/fake-db";

/**
 * Auditoría 069, Fix-A (H-01 … H-08): URLs con el protocolo de APP_BASE_URL,
 * la casa del Super-Admin, su promoción al pasar de `single` a `multi`, la
 * lectura auditada del Blueprint, el alcance del dryRun de creación, las
 * invitaciones vencidas, el locale del negocio y el MCP según la versión.
 */

const h = vi.hoisted(() => ({ fake: null as FakeDb | null, esSuperAdmin: vi.fn() }));

vi.mock("@/lib/db", async (original) => {
  const { crearFakeDb } = await import("./helpers/fake-db");
  h.fake = crearFakeDb();
  return { ...(await original<typeof import("@/lib/db")>()), getDb: () => h.fake!.db };
});
vi.mock("@/server/tenant/consultas", () => ({ esSuperAdmin: h.esSuperAdmin }));
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession: async () => null } }) }));

import {
  origenesDePlataforma,
  raizPlataforma,
  urlDeNegocio,
  urlDeRaiz,
} from "@/lib/tenancy";
import { plataformaPrimero } from "@/server/tenant/inicio";
import { promoverSuperAdmin, sincronizarSuperAdmin } from "@/server/auth/on-signup";
import { urlInvitacion } from "@/server/platform/invitaciones";
import { detalleOrganizacion } from "@/server/platform/organizaciones";
import { GET as blueprintGET } from "@/app/api/platform/organizations/[idOrSlug]/blueprint/route";
import { POST as crearPOST } from "@/app/api/platform/organizations/route";
import { POST as mcpPOST } from "@/app/api/platform/mcp/route";
import { conContenidoEstructurado, versionDePeticion } from "@/server/platform/mcp/servidor";
import { origenPermitido } from "@/server/platform/mcp/origen";
import { partsInTz, labelInTz } from "@/lib/time/slots";
import { textLimitMessage, textoDemasiadoLargo } from "@/server/channels/capabilities";
import { localeDeOrganizacion } from "@/server/region";

const fake = () => h.fake!;
const TOKEN = `alp_${"x".repeat(43)}`;
const filaToken = (scopes: string[]) => ({
  id: "pat_1",
  userId: "u_ops",
  scopes,
  expiresAt: null,
  revokedAt: null,
  lastUsedAt: new Date(),
});
const conToken = (url: string, init: RequestInit = {}) =>
  new Request(url, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });

beforeEach(() => {
  fake().reiniciar();
  h.esSuperAdmin.mockResolvedValue(true);
  vi.stubEnv("TENANCY", "multi");
  vi.stubEnv("PLATFORM_BASE_DOMAIN", "aliantis.co");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("H-01 — URLs con el protocolo y el puerto de APP_BASE_URL", () => {
  it("https por defecto, sin puerto", () => {
    const raiz = raizPlataforma({ PLATFORM_BASE_DOMAIN: "aliantis.co", APP_BASE_URL: "https://aliantis.co" })!;
    expect(urlDeRaiz(raiz, "/empresas")).toBe("https://aliantis.co/empresas");
    expect(urlDeNegocio(raiz, "clinica-sol")).toBe("https://clinica-sol.aliantis.co/");
    expect(origenesDePlataforma(raiz)).toEqual(["https://aliantis.co", "https://*.aliantis.co"]);
  });

  it("staging por HTTP: http en enlaces y orígenes de confianza", () => {
    const raiz = raizPlataforma({
      PLATFORM_BASE_DOMAIN: "169.58.118.66.sslip.io",
      APP_BASE_URL: "http://169.58.118.66.sslip.io",
    })!;
    expect(urlDeNegocio(raiz, "demo", "/invitacion/abc")).toBe("http://demo.169.58.118.66.sslip.io/invitacion/abc");
    expect(origenesDePlataforma(raiz)).toEqual([
      "http://169.58.118.66.sslip.io",
      "http://*.169.58.118.66.sslip.io",
    ]);
  });

  it("desarrollo: conserva el puerto", () => {
    const raiz = raizPlataforma({ PLATFORM_BASE_DOMAIN: "lvh.me", APP_BASE_URL: "http://localhost:3000" })!;
    expect(urlDeNegocio(raiz, "demo")).toBe("http://demo.lvh.me:3000/");
  });

  it("APP_BASE_URL ilegible → https (lo seguro); sin dominio base → null", () => {
    expect(raizPlataforma({ PLATFORM_BASE_DOMAIN: "aliantis.co", APP_BASE_URL: "nada" })).toEqual({
      protocolo: "https:",
      host: "aliantis.co",
    });
    expect(raizPlataforma({ APP_BASE_URL: "https://aliantis.co" })).toBeNull();
  });

  it("el enlace de invitación sale en el subdominio con el protocolo de la instancia", () => {
    vi.stubEnv("APP_BASE_URL", "http://169.58.118.66.sslip.io");
    vi.stubEnv("PLATFORM_BASE_DOMAIN", "169.58.118.66.sslip.io");
    expect(urlInvitacion("demo", "tok")).toBe("http://demo.169.58.118.66.sslip.io/invitacion/tok");
  });

  it("ningún archivo de src vuelve a cablear `https://${…}` para la plataforma", async () => {
    const { readFileSync } = await import("node:fs");
    const archivos = [
      "src/lib/auth/index.ts",
      "src/server/platform/invitaciones.ts",
      "src/app/api/invitaciones/aceptar/route.ts",
      "src/app/(app)/layout.tsx",
      "src/app/(auth)/sin-acceso/page.tsx",
      "src/components/plataforma/gestor-soporte.tsx",
      "src/components/plataforma/selector-empresas.tsx",
    ];
    for (const a of archivos) expect(readFileSync(a, "utf8"), a).not.toMatch(/https:\/\/\$\{/);
  });
});

describe("H-02 — el Super-Admin en la raíz va a /platform", () => {
  const base = { multi: true, base: "aliantis.co", hostEsRaiz: true, superAdmin: true };
  it("Super-Admin miembro de un negocio, en la raíz → plataforma", () => {
    expect(plataformaPrimero(base)).toBe(true);
  });
  it("en el subdominio de un negocio, no: ahí trabaja en ese negocio", () => {
    expect(plataformaPrimero({ ...base, hostEsRaiz: false })).toBe(false);
  });
  it("sin dominio base (elegir empresa es fijar la activa), ni en `single`, ni para un dueño", () => {
    expect(plataformaPrimero({ ...base, base: null })).toBe(false);
    expect(plataformaPrimero({ ...base, multi: false })).toBe(false);
    expect(plataformaPrimero({ ...base, superAdmin: false })).toBe(false);
  });
});

describe("H-03 — promoción idempotente al iniciar sesión", () => {
  it("correo listado → platform_admin + auditoría con su origen", async () => {
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", "Ops@Aliantis.co");
    expect(await promoverSuperAdmin("u_1", "ops@aliantis.co", "inicio_de_sesion")).toBe(true);
    expect(fake().de(schema.platformAdmin, "insert")[0]?.valores).toMatchObject({ userId: "u_1" });
    expect(fake().de(schema.platformAuditLog)[0]?.valores).toMatchObject({
      action: "admin_registrado",
      actorUserId: "u_1",
      detail: { origen: "inicio_de_sesion" },
    });
  });

  it("correo no listado, o en `single` → nada", async () => {
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", "ops@aliantis.co");
    expect(await promoverSuperAdmin("u_1", "otro@aliantis.co", "inicio_de_sesion")).toBe(false);
    vi.stubEnv("TENANCY", "single");
    expect(await promoverSuperAdmin("u_1", "ops@aliantis.co", "inicio_de_sesion")).toBe(false);
    expect(fake().escrituras).toEqual([]);
  });

  it("sincronizar lee el correo del usuario (el dueño que venía de `single`)", async () => {
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", "ops@aliantis.co");
    fake().responder(schema.user, [{ email: "ops@aliantis.co" }]);
    await sincronizarSuperAdmin("u_viejo");
    expect(fake().de(schema.platformAdmin, "insert")[0]?.valores).toMatchObject({ userId: "u_viejo" });
  });

  it("sin lista de correos ni siquiera consulta la base", async () => {
    await sincronizarSuperAdmin("u_1");
    expect(fake().escrituras).toEqual([]);
  });
});

function responderExport() {
  // buscarOrganizacion, luego la fila completa de exportarBlueprint.
  fake().responder(schema.organization, [{ id: "org_1", slug: "demo" }]);
  fake().responder(schema.organization, [
    { id: "org_1", slug: "demo", name: "Demo", metadata: null, modules: null },
  ]);
}

describe("H-04 — leer el Blueprint queda auditado (REST y MCP)", () => {
  it("REST GET …/blueprint → blueprint_exportado con vía api y token", async () => {
    fake().responder(schema.platformApiToken, [filaToken(["read"])]);
    responderExport();
    const res = await blueprintGET(conToken("https://aliantis.co/api/platform/organizations/demo/blueprint"), {
      params: Promise.resolve({ idOrSlug: "demo" }),
    });
    expect(res.status).toBe(200);
    expect(fake().de(schema.platformAuditLog).map((e) => e.valores)).toEqual([
      expect.objectContaining({ action: "blueprint_exportado", organizationId: "org_1", via: "api", tokenId: "pat_1" }),
    ]);
  });

  it("MCP get_blueprint → la misma entrada, con vía mcp", async () => {
    vi.stubEnv("PLATFORM_MCP", "on");
    fake().responder(schema.platformApiToken, [filaToken(["read"])]);
    responderExport();
    const res = await mcpPOST(
      conToken("https://aliantis.co/api/platform/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "get_blueprint", arguments: { idOrSlug: "demo" } },
        }),
      })
    );
    expect(res.status).toBe(200);
    expect(fake().de(schema.platformAuditLog).map((e) => e.valores)).toEqual([
      expect.objectContaining({ action: "blueprint_exportado", organizationId: "org_1", via: "mcp" }),
    ]);
  });
});

describe("H-05 — planificar la creación basta con `read`", () => {
  it("POST ?dryRun=true con token read → 200 (plan)", async () => {
    fake().responder(schema.platformApiToken, [filaToken(["read"])]);
    const res = await crearPOST(
      conToken("https://aliantis.co/api/platform/organizations?dryRun=true", {
        method: "POST",
        body: JSON.stringify({ version: 1, organization: { slug: "nuevo-negocio", name: "Nuevo" } }),
      })
    );
    expect(res.status).toBe(200);
    // El dryRun escribe dentro de una transacción que se revierte; la base
    // falsa no revierte, así que se comprueba lo que responde.
    expect(((await res.json()) as { dryRun: boolean }).dryRun).toBe(true);
  });

  it("crear de verdad sigue exigiendo provision → 403", async () => {
    fake().responder(schema.platformApiToken, [filaToken(["read"])]);
    const res = await crearPOST(
      conToken("https://aliantis.co/api/platform/organizations", {
        method: "POST",
        body: JSON.stringify({ version: 1, organization: { slug: "nuevo-negocio", name: "Nuevo" } }),
      })
    );
    expect(res.status).toBe(403);
  });
});

describe("H-06 — invitaciones vencidas", () => {
  it("se marcan `vencida` y van al final", async () => {
    const ahora = Date.now();
    fake().responder(schema.organization, [
      { id: "org_1", slug: "demo", name: "Demo", status: "activa", createdAt: new Date(), suspendedAt: null, metadata: null, modules: null },
    ]);
    fake().responder(schema.member, []);
    fake().responder(schema.invitation, [
      { id: "inv_viejo", email: "a@x.co", role: "owner", expiresAt: new Date(ahora - 86_400_000) },
      { id: "inv_nuevo", email: "b@x.co", role: "owner", expiresAt: new Date(ahora + 86_400_000) },
    ]);
    const d = await detalleOrganizacion("org_1");
    expect(d!.invitaciones.map((i) => [i.id, i.vencida])).toEqual([
      ["inv_nuevo", false],
      ["inv_viejo", true],
    ]);
  });
});

describe("H-07 — el locale del negocio en fechas y avisos", () => {
  const cita = "2026-08-05T15:00:00.000Z";
  it("partsInTz y labelInTz respetan el locale pedido", () => {
    expect(partsInTz(cita, "America/Bogota", "en-US").weekday).toBe("Wednesday");
    expect(partsInTz(cita, "America/Bogota", "es-CO").weekday).toBe("miércoles");
    expect(labelInTz(cita, "America/Bogota", "en-US")).toMatch(/^Wed 5 Aug, 10:00 AM$/);
  });

  it("los avisos de longitud formatean el número con el locale del negocio", () => {
    expect(textLimitMessage("whatsapp", "en-US")).toContain("4,096");
    expect(textLimitMessage("whatsapp", "es-CO")).toContain("4096".replace(/(\d)(\d{3})$/, "$1.$2"));
    expect(textoDemasiadoLargo("en-US")).toMatch(/\d,\d{3}/);
  });

  it("en `single`, el de la instancia sin tocar la base", async () => {
    vi.stubEnv("TENANCY", "single");
    vi.stubEnv("REGION_LOCALE", "es-CO");
    expect(await localeDeOrganizacion("org_1")).toBe("es-CO");
    expect(fake().escrituras).toEqual([]);
  });

  it("en `multi`, el guardado en la región del negocio", async () => {
    fake().responder(schema.organization, [{ metadata: JSON.stringify({ region: { locale: "en-US" } }) }]);
    expect(await localeDeOrganizacion("org_1")).toBe("en-US");
  });
});

describe("H-08 — MCP: versión negociada y Origin", () => {
  it("MCP-Protocol-Version: ausente → 2025-03-26; soportada → esa; otra → null", () => {
    expect(versionDePeticion(null)).toBe("2025-03-26");
    expect(versionDePeticion("2025-06-18")).toBe("2025-06-18");
    expect(versionDePeticion("1999-01-01")).toBeNull();
    expect(conContenidoEstructurado("2025-06-18")).toBe(true);
    expect(conContenidoEstructurado("2025-03-26")).toBe(false);
    expect(conContenidoEstructurado("2024-11-05")).toBe(false);
  });

  async function catalogo(version?: string) {
    vi.stubEnv("PLATFORM_MCP", "on");
    fake().responder(schema.platformApiToken, [filaToken(["read"])]);
    const res = await mcpPOST(
      conToken("https://aliantis.co/api/platform/mcp", {
        method: "POST",
        headers: version ? { "mcp-protocol-version": version } : {},
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_catalog" } }),
      })
    );
    return { status: res.status, body: (await res.json()) as { result?: Record<string, unknown> } };
  }

  it("structuredContent solo con 2025-06-18; content siempre", async () => {
    const nueva = await catalogo("2025-06-18");
    expect(nueva.body.result).toHaveProperty("structuredContent");
    const vieja = await catalogo("2024-11-05");
    expect(vieja.body.result).not.toHaveProperty("structuredContent");
    expect(vieja.body.result).toHaveProperty("content");
  });

  it("una versión que no hablamos → 400", async () => {
    expect((await catalogo("1999-01-01")).status).toBe(400);
  });

  it("Origin: la raíz, sus subdominios y el origen exacto de APP_BASE_URL", () => {
    const env = { PLATFORM_BASE_DOMAIN: "aliantis.co", APP_BASE_URL: "http://localhost:3000" };
    expect(origenPermitido(null, env)).toBe(true);
    expect(origenPermitido("https://aliantis.co", env)).toBe(true);
    expect(origenPermitido("https://demo.aliantis.co", env)).toBe(true);
    expect(origenPermitido("http://localhost:3000", env)).toBe(true);
    expect(origenPermitido("http://localhost:6274", env)).toBe(false);
    expect(origenPermitido("https://evil.example", env)).toBe(false);
    expect(origenPermitido("no-es-url", env)).toBe(false);
  });
});
