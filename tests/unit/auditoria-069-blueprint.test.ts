import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/lib/db";
import type { FakeDb } from "./helpers/fake-db";

/**
 * Auditoría 069, Fix-B — El Blueprint cubre también la apariencia y las
 * respuestas rápidas; el catálogo guía a una IA con ejemplos que validan; el
 * MCP gana `revoke_invitation` y `list_audit_log`, equivalentes a la REST.
 */

const h = vi.hoisted(() => ({ fake: null as FakeDb | null, esSuperAdmin: vi.fn() }));

vi.mock("@/lib/db", async (original) => {
  const { crearFakeDb } = await import("./helpers/fake-db");
  h.fake = crearFakeDb();
  return { ...(await original<typeof import("@/lib/db")>()), getDb: () => h.fake!.db };
});
vi.mock("@/server/tenant/consultas", () => ({ esSuperAdmin: h.esSuperAdmin }));
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession: async () => null } }) }));

import { blueprintSchema } from "@/lib/platform/blueprint";
import { aplicarBlueprint } from "@/server/platform/blueprint/aplicar";
import { exportarBlueprint } from "@/server/platform/blueprint/exportar";
import { planificarRespuestas } from "@/server/platform/blueprint/secciones/respuestas";
import { catalogoPlataforma, EJEMPLO_COMPLETO, EJEMPLO_MINIMO } from "@/server/platform/catalogo";
import { limiteAuditoria } from "@/server/platform/auditoria-consulta";
import { POST as mcpPOST } from "@/app/api/platform/mcp/route";
import { PUT as blueprintPUT } from "@/app/api/platform/organizations/[idOrSlug]/blueprint/route";
import { DELETE as revocarREST } from "@/app/api/platform/organizations/[idOrSlug]/invitations/[invitationId]/route";
import { GET as auditREST } from "@/app/api/platform/audit/route";

const fake = () => h.fake!;
const actor = { userId: "u_ops", via: "api" as const, tokenId: "pat_1" };
const TOKEN = `alp_${"x".repeat(43)}`;
const filaToken = (scopes: string[]) => ({
  id: "pat_1",
  userId: "u_ops",
  scopes,
  expiresAt: null,
  revokedAt: null,
  lastUsedAt: new Date(),
});

const apariencia = { tema: "vocero", letra: "archivo", tamano: "grande", densidad: "compacta" };
const fila = {
  id: "org_A",
  name: "Clínica Sol",
  slug: "clinica-sol",
  metadata: JSON.stringify({ branding: { name: "Clínica Sol", accent: "#0d3b9e", currency: "COP", favicon: null } }),
  modules: null,
};

beforeEach(() => {
  fake().reiniciar();
  h.esSuperAdmin.mockResolvedValue(true);
  vi.stubEnv("TENANCY", "multi");
  vi.stubEnv("PLATFORM_BASE_DOMAIN", "aliantis.co");
  vi.stubEnv("PLATFORM_MCP", "on");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function rutas(r: ReturnType<typeof blueprintSchema.safeParse>) {
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}:${i.message}`);
}

describe("Fix-B — contrato: appearance y quickReplies", () => {
  it("la apariencia de Ajustes → Apariencia es válida; campos de más, no", () => {
    expect(blueprintSchema.safeParse({ version: 1, appearance: apariencia }).success).toBe(true);
    expect(blueprintSchema.safeParse({ version: 1, appearance: { ...apariencia, extra: 1 } }).success).toBe(false);
    expect(blueprintSchema.safeParse({ version: 1, appearance: { ...apariencia, tema: "neon" } }).success).toBe(false);
  });

  it("un tema propio ilegible se rechaza con su ruta", () => {
    const r = blueprintSchema.safeParse({
      version: 1,
      appearance: { ...apariencia, tema: "propio", propio: { fondo: "#ffffff", texto: "#fefefe", marco: "#000000" } },
    });
    expect(rutas(r)).toContain("appearance.propio:tema_propio_ilegible");
  });

  it("el atajo se normaliza como en el compositor (sin /, acentos ni espacios)", () => {
    const r = blueprintSchema.parse({
      version: 1,
      quickReplies: { entries: [{ shortcut: "/Envío Gratis", text: "Hola {nombre}" }] },
    });
    expect(r.quickReplies).toEqual({ mode: "merge", entries: [{ shortcut: "envio-gratis", text: "Hola {nombre}" }] });
  });

  it("atajo vacío o repetido (tras normalizar) → 422 con ruta", () => {
    expect(rutas(blueprintSchema.safeParse({ version: 1, quickReplies: { entries: [{ shortcut: "///", text: "x" }] } }))).toContain(
      "quickReplies.entries.0.shortcut:atajo_invalido"
    );
    expect(
      rutas(
        blueprintSchema.safeParse({
          version: 1,
          quickReplies: { entries: [{ shortcut: "pagos", text: "a" }, { shortcut: "/Pagos", text: "b" }] },
        })
      )
    ).toContain("quickReplies.entries:atajos_repetidos");
  });

  it("un secreto dentro de una respuesta rápida también se detecta", () => {
    const r = blueprintSchema.safeParse({
      version: 1,
      quickReplies: { entries: [{ shortcut: "llave", text: `sk-${"a".repeat(30)}` }] },
    });
    expect(rutas(r)).toContain("quickReplies.entries.0.text:secreto_detectado");
  });
});

describe("Fix-B — plan de respuestas rápidas (puro)", () => {
  const actuales = [
    { id: "qr_1", atajo: "pagos", texto: "Efectivo" },
    { id: "qr_2", atajo: "direccion", texto: "Calle 10" },
  ];
  it("merge: crea lo nuevo, actualiza el texto distinto y nunca borra", () => {
    const plan = planificarRespuestas(actuales, {
      mode: "merge",
      entries: [
        { shortcut: "pagos", text: "Efectivo y Nequi" },
        { shortcut: "horario", text: "8 a 5" },
      ],
    });
    expect(plan).toEqual({
      crear: [{ atajo: "horario", texto: "8 a 5" }],
      actualizar: [{ id: "qr_1", texto: "Efectivo y Nequi" }],
      borrar: [],
    });
  });
  it("exact: además borra lo que no viene; lo mismo dos veces no cambia nada", () => {
    expect(
      planificarRespuestas(actuales, { mode: "exact", entries: [{ shortcut: "pagos", text: "Efectivo" }] }).borrar
    ).toEqual(["qr_2"]);
    expect(
      planificarRespuestas(actuales, {
        mode: "exact",
        entries: actuales.map((a) => ({ shortcut: a.atajo, text: a.texto })),
      })
    ).toEqual({ crear: [], actualizar: [], borrar: [] });
  });
});

describe("Fix-B — aplicar y exportar", () => {
  it("appearance va a metadata.apariencia sin tocar la marca; quickReplies se insertan", async () => {
    fake().responder(schema.organization, [fila]);
    fake().responder(schema.quickReply, []);
    const r = await aplicarBlueprint(actor, { organizationId: "org_A" }, {
      version: 1,
      appearance: apariencia,
      quickReplies: { entries: [{ shortcut: "pagos", text: "Efectivo y Nequi" }] },
    });
    expect(r.sections).toEqual({ appearance: "actualizada", quickReplies: "actualizada" });
    const meta = JSON.parse(String(fake().de(schema.organization, "update")[0]?.valores.metadata));
    expect(meta.apariencia).toEqual(apariencia);
    expect(meta.branding.accent).toBe("#0d3b9e");
    expect(fake().de(schema.quickReply, "insert").map((e) => e.valores)).toEqual([
      expect.objectContaining({ organizationId: "org_A", atajo: "pagos", texto: "Efectivo y Nequi" }),
    ]);
  });

  it("exportar incluye appearance y quickReplies, y reaplicarlo → sin_cambios sin escrituras", async () => {
    const conApariencia = { ...fila, metadata: JSON.stringify({ ...JSON.parse(fila.metadata), apariencia }) };
    const respuestas = [{ id: "qr_1", atajo: "pagos", texto: "Efectivo" }];
    // exportarBlueprint: organización, etapas, perfil, conocimiento, ¿agenda?, respuestas.
    fake().responder(schema.organization, [conApariencia]);
    fake().responder(schema.quickReply, respuestas);
    const bp = await exportarBlueprint("org_A");
    expect(bp).toMatchObject({
      appearance: apariencia,
      quickReplies: { mode: "exact", entries: [{ shortcut: "pagos", text: "Efectivo" }] },
    });

    fake().reiniciar();
    fake().responder(schema.organization, [conApariencia]);
    fake().responder(schema.kbEntry, []);
    fake().responder(schema.quickReply, respuestas);
    const r = await aplicarBlueprint(actor, { organizationId: "org_A" }, {
      version: 1,
      appearance: bp!.appearance,
      quickReplies: bp!.quickReplies,
    });
    expect(r.sections).toEqual({ appearance: "sin_cambios", quickReplies: "sin_cambios" });
    expect(fake().escrituras.filter((e) => e.tabla !== schema.platformAuditLog)).toEqual([]);
  });

  it("sin apariencia elegida ni respuestas, el export no trae esas secciones", async () => {
    fake().responder(schema.organization, [fila]);
    const bp = await exportarBlueprint("org_A");
    expect(bp).not.toHaveProperty("appearance");
    expect(bp).not.toHaveProperty("quickReplies");
  });
});

describe("Fix-B — catálogo para IAs", () => {
  it("los dos ejemplos validan contra el contrato", () => {
    expect(rutas(blueprintSchema.safeParse(EJEMPLO_MINIMO))).toEqual([]);
    expect(rutas(blueprintSchema.safeParse(EJEMPLO_COMPLETO))).toEqual([]);
  });

  it("trae presets de color, temas, regiones (Colombia primero) y etapas por defecto", () => {
    const c = catalogoPlataforma();
    expect(c.brand.accentPresets[0]).toEqual({ accent: "#0d3b9e", label: "Azul Aliantis" });
    expect(c.appearance.themes.map((t) => t.id)).toContain("vocero");
    expect(c.regionSuggestions[0]).toMatchObject({ country: "CO", locale: "es-CO", timezone: "America/Bogota" });
    expect(c.pipeline.defaultStages.open).toEqual(["Nuevo", "En conversación", "Interesado"]);
    expect(c.quickReplies.maxEntries).toBeGreaterThan(0);
    const props = (c.schema as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(props)).toEqual(expect.arrayContaining(["appearance", "quickReplies"]));
  });

  it("cada región sugerida es válida para el contrato (país, locale, zona y moneda)", () => {
    for (const r of catalogoPlataforma().regionSuggestions) {
      const bp = { version: 1, region: { country: r.country, locale: r.locale, timezone: r.timezone }, brand: { currency: r.currency } };
      expect(rutas(blueprintSchema.safeParse(bp)), r.label).toEqual([]);
    }
  });

  it("el límite de auditoría se acota", () => {
    expect(limiteAuditoria(undefined)).toBe(50);
    expect(limiteAuditoria(5000)).toBe(200);
    expect(limiteAuditoria("10")).toBe(10);
    expect(limiteAuditoria(-1)).toBe(50);
  });
});

function rpc(name: string, args: unknown) {
  return new Request("https://aliantis.co/api/platform/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
}
const conToken = (url: string, init: RequestInit = {}) =>
  new Request(url, { ...init, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" } });

/** Lo escrito, sin ids aleatorios, fechas, hash ni vía. */
function normalizado() {
  const aleatorio = /^(org|mem|stg|agp|inv|aud|kb|cal|sop|pat|qr)_[a-z0-9]+$/;
  const limpiar = (v: unknown): unknown => {
    if (typeof v === "string") return aleatorio.test(v) ? v.split("_")[0] + "_*" : v;
    if (v instanceof Date) return "<fecha>";
    if (Array.isArray(v)) return v.map(limpiar);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([k]) => !["tokenHash", "via", "expiresAt", "updatedAt"].includes(k))
          .map(([k, x]) => [k, limpiar(x)])
      );
    }
    return v;
  };
  return fake().escrituras.map((e) => ({ op: e.op, tabla: e.tabla, valores: limpiar(e.valores) }));
}

describe("Fix-B — equivalencia REST ↔ MCP de lo nuevo", () => {
  const bp = {
    version: 1,
    appearance: apariencia,
    quickReplies: { mode: "exact", entries: [{ shortcut: "pagos", text: "Efectivo y Nequi" }] },
  };
  function encolar() {
    fake().responder(schema.platformApiToken, [filaToken(["read", "provision"])]);
    fake().responder(schema.organization, [{ id: "org_A", slug: "clinica-sol" }]); // buscarOrganizacion
    fake().responder(schema.organization, [fila]); // dentro de la transacción
    fake().responder(schema.quickReply, [{ id: "qr_9", atajo: "viejo", texto: "x" }]);
  }

  it("appearance + quickReplies: mismas escrituras por PUT …/blueprint y por apply_blueprint", async () => {
    encolar();
    const rest = await blueprintPUT(
      conToken("https://aliantis.co/api/platform/organizations/clinica-sol/blueprint", {
        method: "PUT",
        body: JSON.stringify(bp),
      }),
      { params: Promise.resolve({ idOrSlug: "clinica-sol" }) }
    );
    expect(rest.status).toBe(200);
    const porRest = normalizado();
    const seccionesRest = ((await rest.json()) as { sections: unknown }).sections;

    fake().reiniciar();
    encolar();
    const body = (await (await mcpPOST(rpc("apply_blueprint", { idOrSlug: "clinica-sol", blueprint: bp }))).json()) as {
      result: { isError: boolean; structuredContent: { sections: unknown } };
    };
    expect(body.result.isError).toBe(false);
    expect(normalizado()).toEqual(porRest);
    expect(body.result.structuredContent.sections).toEqual(seccionesRest);
    expect(seccionesRest).toEqual({ appearance: "actualizada", quickReplies: "actualizada" });
    expect(fake().de(schema.quickReply, "delete")).toHaveLength(1); // exact borra «viejo»
  });

  it("revoke_invitation ≡ DELETE …/invitations/[id] (y 404 ≡ invitacion_inexistente)", async () => {
    const encolarRevocar = (existe: boolean) => {
      fake().responder(schema.platformApiToken, [filaToken(["read", "provision"])]);
      fake().responder(schema.organization, [{ id: "org_A", slug: "clinica-sol" }]);
      fake().responder("update:", existe ? [{ id: "inv_1" }] : []);
    };
    encolarRevocar(true);
    const rest = await revocarREST(conToken("https://aliantis.co/x", { method: "DELETE" }), {
      params: Promise.resolve({ idOrSlug: "clinica-sol", invitationId: "inv_1" }),
    });
    expect(rest.status).toBe(200);
    const porRest = normalizado();

    fake().reiniciar();
    encolarRevocar(true);
    const ok = (await (await mcpPOST(rpc("revoke_invitation", { idOrSlug: "clinica-sol", invitationId: "inv_1" }))).json()) as {
      result: { isError: boolean; structuredContent: unknown };
    };
    expect(ok.result).toMatchObject({ isError: false, structuredContent: { revoked: true } });
    expect(normalizado()).toEqual(porRest);
    expect(fake().de(schema.platformAuditLog)[0]?.valores).toMatchObject({ action: "invitacion_revocada", via: "mcp" });

    fake().reiniciar();
    encolarRevocar(false);
    const no = (await (await mcpPOST(rpc("revoke_invitation", { idOrSlug: "clinica-sol", invitationId: "inv_x" }))).json()) as {
      result: { isError: boolean; structuredContent: { error: { code: string } } };
    };
    expect(no.result.isError).toBe(true);
    expect(no.result.structuredContent.error.code).toBe("invitacion_inexistente");
  });

  it("list_audit_log ≡ GET /api/platform/audit, con página siguiente", async () => {
    const entradas = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `aud_${i}`,
        action: "blueprint_aplicado",
        via: "api",
        organizationId: "org_A",
        tokenId: "pat_1",
        detail: { sections: {} },
        ip: null,
        createdAt: new Date(Date.UTC(2026, 10, 17, 12, 0, 60 - i)),
        actor: "ops@aliantis.co",
      }));
    fake().responder(schema.platformApiToken, [filaToken(["read"])]);
    fake().responder(schema.platformAuditLog, entradas(3));
    const rest = (await (await auditREST(conToken("https://aliantis.co/api/platform/audit?limit=2"))).json()) as {
      entries: unknown[];
      nextBefore: string | null;
    };
    expect(rest.entries).toHaveLength(2);
    expect(rest.nextBefore).toBe("2026-11-17T12:00:59.000Z");

    fake().reiniciar();
    fake().responder(schema.platformApiToken, [filaToken(["read"])]);
    fake().responder(schema.platformAuditLog, entradas(3));
    const mcp = (await (await mcpPOST(rpc("list_audit_log", { limit: 2 }))).json()) as {
      result: { structuredContent: unknown };
    };
    expect(mcp.result.structuredContent).toEqual(rest);
  });
});
