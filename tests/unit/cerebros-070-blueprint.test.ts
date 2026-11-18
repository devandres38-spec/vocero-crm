import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/lib/db";
import type { FakeDb } from "./helpers/fake-db";

/**
 * 070 — Bloque 3, F7 y punto 2: el campo `brain` del Blueprint (esquema,
 * aplicar, exportar, formulario), la herramienta MCP de solo lectura y el
 * juez del Laboratorio pagando solo con la llave del negocio en `multi`.
 */

const h = vi.hoisted(() => ({ fake: null as FakeDb | null, credencial: vi.fn() }));

vi.mock("@/lib/db", async (original) => {
  const { crearFakeDb } = await import("./helpers/fake-db");
  h.fake = crearFakeDb();
  return { ...(await original<typeof import("@/lib/db")>()), getDb: () => h.fake!.db };
});
vi.mock("@/server/ai/credentials", async (original) => ({
  ...(await original<typeof import("@/server/ai/credentials")>()),
  getAiCredentialSecret: h.credencial,
  marcarEstadoPorRespuesta: vi.fn(),
}));

import { z } from "zod";
import { blueprintSchema } from "@/lib/platform/blueprint";
import {
  blueprintParaEnviar,
  formularioDesdeBlueprint,
  formularioInicial,
  PESTANA_DE_SECCION,
  seccionesDelFormulario,
} from "@/lib/platform/formulario-blueprint";
import { aplicarCerebro } from "@/server/platform/blueprint/secciones/cerebro";
import { herramientas } from "@/server/platform/mcp/herramientas";
import { chatJson } from "@/lib/ai";

const fake = () => h.fake!;
const ACTOR = { userId: "usr_admin", via: "mcp" as const, tokenId: "pat_1", ip: "1.1.1.1" };
const DEFAULTS = { country: "CO", locale: "es-CO", timezone: "America/Bogota", currency: "COP", accent: "#0d3b9e", etapas: ["Nuevo"] };
const TECHO = { agenda: true, atribucion: false, channels: ["whatsapp"] };

beforeEach(() => {
  fake().reiniciar();
  h.credencial.mockReset();
  vi.unstubAllEnvs();
});

describe("Blueprint: brain", () => {
  it("acepta un id o null; nunca URLs ni secretos", () => {
    expect(blueprintSchema.safeParse({ version: 1, brain: { deployment: "brn_1" } }).success).toBe(true);
    expect(blueprintSchema.safeParse({ version: 1, brain: null }).success).toBe(true);
    expect(blueprintSchema.safeParse({ version: 1, brain: { deployment: "brn_1", url: "http://nea" } }).success).toBe(false);
    expect(blueprintSchema.safeParse({ version: 1, brain: { deployment: "" } }).success).toBe(false);
  });

  it("aplicar: asigna un despliegue activo y lo audita como `cerebro_asignado` desde el Blueprint", async () => {
    fake().responder(schema.brainDeployment, [{ status: "activo" }]);
    fake().responder(schema.organization, [{ actual: null }]);
    expect(await aplicarCerebro(fake().db as never, ACTOR, "org_A", { deployment: "brn_1" })).toBe(true);
    expect(fake().de(schema.organization, "update")[0]!.valores).toEqual({ brainDeploymentId: "brn_1" });
    expect(fake().de(schema.platformAuditLog, "insert")[0]!.valores).toMatchObject({
      action: "cerebro_asignado",
      organizationId: "org_A",
      via: "mcp",
      detail: { antes: null, despues: "brn_1", desde: "blueprint" },
    });
  });

  it("idempotente: el mismo cerebro no cambia nada", async () => {
    fake().responder(schema.brainDeployment, [{ status: "activo" }]);
    fake().responder(schema.organization, [{ actual: "brn_1" }]);
    expect(await aplicarCerebro(fake().db as never, ACTOR, "org_A", { deployment: "brn_1" })).toBe(false);
    expect(fake().escrituras).toHaveLength(0);
  });

  it("inexistente o pausado → error con la ruta exacta", async () => {
    fake().responder(schema.brainDeployment, []);
    await expect(aplicarCerebro(fake().db as never, ACTOR, "org_A", { deployment: "brn_x" })).rejects.toMatchObject({
      code: "cerebro_no_encontrado",
      issues: [{ path: "brain.deployment" }],
    });
    fake().responder(schema.brainDeployment, [{ status: "pausado" }]);
    await expect(aplicarCerebro(fake().db as never, ACTOR, "org_A", { deployment: "brn_1" })).rejects.toMatchObject({
      code: "cerebro_pausado",
    });
  });

  it("null lo quita (bandeja manual)", async () => {
    fake().responder(schema.organization, [{ actual: "brn_1" }]);
    expect(await aplicarCerebro(fake().db as never, ACTOR, "org_A", null)).toBe(true);
    expect(fake().de(schema.organization, "update")[0]!.valores).toEqual({ brainDeploymentId: null });
  });

  it("aplicar y exportar lo conocen", () => {
    const aplicar = readFileSync(join(process.cwd(), "src/server/platform/blueprint/aplicar.ts"), "utf8");
    expect(aplicar).toMatch(/bp\.brain !== undefined/);
    const exportar = readFileSync(join(process.cwd(), "src/server/platform/blueprint/exportar.ts"), "utf8");
    expect(exportar).toMatch(/bp\.brain = \{ deployment: org\.brainDeploymentId \}/);
  });
});

describe("FormularioBlueprint: selector de cerebro", () => {
  it("al crear: solo se manda si se eligió uno", () => {
    const f = formularioInicial(DEFAULTS, TECHO);
    expect(seccionesDelFormulario(f, "crear", TECHO).brain).toBeUndefined();
    f.brain = { deployment: "brn_1" };
    expect(seccionesDelFormulario(f, "crear", TECHO).brain).toEqual({ deployment: "brn_1" });
  });

  it("al editar: se carga del Blueprint, no se reenvía si no cambió y `null` lo quita", () => {
    const bp = blueprintSchema.parse({ version: 1, organization: { slug: "clinica", name: "Clínica" }, brain: { deployment: "brn_1" } });
    const f = formularioDesdeBlueprint(bp, DEFAULTS, TECHO);
    expect(f.brain).toEqual({ deployment: "brn_1" });
    const base = seccionesDelFormulario(f, "editar", TECHO);
    expect(blueprintParaEnviar(f, "editar", TECHO, base).modificadas).not.toContain("brain");
    f.brain = { deployment: "" };
    const r = blueprintParaEnviar(f, "editar", TECHO, base);
    expect(r.modificadas).toContain("brain");
    expect(r.blueprint.brain).toBeNull();
    expect(PESTANA_DE_SECCION.brain).toBe("agente");
  });
});

describe("MCP: list_brain_deployments (solo lectura, sin secretos)", () => {
  it("existe, es de lectura y no expone URLs completas ni el cifrado", async () => {
    const t = herramientas().find((x) => x.name === "list_brain_deployments")!;
    expect(t.scope).toBe("read");
    expect(t.annotations.readOnlyHint).toBe(true);
    fake().responder(schema.brainDeployment, [
      {
        id: "brn_1",
        name: "Nea",
        dispatchUrl: "http://nea:8000/vocero/dispatch",
        healthUrl: null,
        secretCipher: "CIFRADO",
        secretIv: "IV",
        secretTag: "TAG",
        secretLast4: "wxyz",
        status: "activo",
        lastHealthAt: null,
        lastHealthOk: true,
        lastHealthDetail: { mode: "multiorg" },
        createdBy: null,
        createdAt: new Date("2026-11-18T00:00:00Z"),
        updatedAt: new Date("2026-11-18T00:00:00Z"),
      },
    ]);
    fake().responder(schema.organization, [{ id: "brn_1", n: 2 }]);
    const r = (await t.run({} as never, {})) as { deployments: Record<string, unknown>[] };
    expect(r.deployments[0]).toEqual({
      id: "brn_1",
      name: "Nea",
      host: "nea:8000",
      status: "activo",
      lastHealthOk: true,
      lastHealthAt: null,
      mode: "multiorg",
      organizations: 2,
    });
    expect(JSON.stringify(r)).not.toMatch(/CIFRADO|wxyz|vocero\/dispatch/);
  });
});

describe("juez del Laboratorio en `multi`: solo la llave del negocio", () => {
  it("sin llave propia, chatJson con soloOrganizacion NO usa la del entorno ni llama al proveedor", async () => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "sk-or-de-la-plataforma");
    vi.stubEnv("OPENROUTER_MODEL", "modelo/plataforma");
    h.credencial.mockResolvedValue(null);
    const espia = vi.spyOn(globalThis, "fetch");
    const r = await chatJson(z.object({ ok: z.boolean() }), [{ role: "user", content: "x" }], {
      judge: true,
      organizationId: "org_A",
      soloOrganizacion: true,
    });
    expect(r.ok).toBe(false);
    expect(espia).not.toHaveBeenCalled();
    espia.mockRestore();
  });

  it("el juez y la pantalla del Laboratorio lo piden en modo plataforma", () => {
    expect(readFileSync(join(process.cwd(), "src/server/lab/judge.ts"), "utf8")).toMatch(/soloOrganizacion: esPlataforma\(\)/);
    const lab = readFileSync(join(process.cwd(), "src/app/api/lab/runs/route.ts"), "utf8");
    expect(lab).toMatch(/if \(!esPlataforma\(\)\) return isAiConfiguredFor\(organizationId\)/);
    // M-7: además del sí/no de la llave, un modelo con qué juzgar.
    expect(lab).toMatch(/r\.ok && Boolean\(r\.provider\.model\?\.trim\(\)\)/);
  });
});
