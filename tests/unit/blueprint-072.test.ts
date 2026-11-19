import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/lib/db";
import type { FakeDb } from "./helpers/fake-db";

/**
 * 072 (A5) — Plantillas de nicho en el Blueprint, el panel y el MCP:
 * secciones `vertical` y `fichaFields`, semillas válidas e idempotentes, el
 * formulario «Empezar desde plantilla» / «Cargar plantilla» y las
 * herramientas MCP de solo lectura.
 */

const h = vi.hoisted(() => ({ fake: null as FakeDb | null }));
vi.mock("@/lib/db", async (original) => {
  const { crearFakeDb } = await import("./helpers/fake-db");
  h.fake = crearFakeDb();
  return { ...(await original<typeof import("@/lib/db")>()), getDb: () => h.fake!.db };
});
vi.mock("@/lib/env", async (original) => ({
  ...(await original<typeof import("@/lib/env")>()),
  getEnv: () => ({ APP_BASE_URL: "https://crm.local" }),
}));

import { blueprintSchema } from "@/lib/platform/blueprint";
import {
  aplicarPlantillaAlFormulario,
  blueprintParaEnviar,
  formularioDesdeBlueprint,
  formularioDesdePlantilla,
  formularioInicial,
  seccionesDelFormulario,
} from "@/lib/platform/formulario-blueprint";
import { aplicarBlueprint, BlueprintError } from "@/server/platform/blueprint/aplicar";
import { exportarBlueprint } from "@/server/platform/blueprint/exportar";
import { advertenciasDeOverrides } from "@/server/platform/blueprint/secciones/vertical";
import { catalogoPlataforma, detalleDePack, listaDePacks } from "@/server/platform/catalogo";
import { herramientas, ErrorHerramienta } from "@/server/platform/mcp/herramientas";
import { PACK_IDS, PACKS } from "@/verticals/registro";
import { semillaDe } from "@/verticals/semilla";

const fake = () => h.fake!;
const actor = { userId: "u_ops", via: "api" as const, tokenId: "pat_1" };
const DEFAULTS = { country: "CO", locale: "es-CO", timezone: "America/Bogota", currency: "COP", accent: "#0d3b9e", etapas: ["Nuevo", "En conversación", "Interesado"] };
const TECHO = { agenda: true, atribucion: false, channels: ["whatsapp"] };

beforeEach(() => {
  fake().reiniciar();
  vi.stubEnv("TENANCY", "multi");
  vi.stubEnv("PLATFORM_BASE_DOMAIN", "aliantis.co");
});
afterEach(() => vi.unstubAllEnvs());

describe("el contrato", () => {
  it("cada semilla (con versión) es un Blueprint v1 válido y trae su nicho", () => {
    for (const id of PACK_IDS) {
      const bp = { version: 1, ...semillaDe(id) };
      expect(blueprintSchema.safeParse(bp).success, id).toBe(true);
      expect(bp.vertical).toEqual({ pack: id });
    }
    expect(semillaDe("eventos-mobiliario").fichaFields?.fields.map((f) => f.key)).toEqual([
      "fecha_evento",
      "tipo_evento",
      "num_invitados",
      "ciudad_evento",
      "presupuesto_aprox",
    ]);
    expect(semillaDe("default")).toEqual({ vertical: { pack: "default" } });
  });

  it("un pack desconocido, overrides con código o campos inválidos son 422", () => {
    const mal = (x: Record<string, unknown>) => blueprintSchema.safeParse({ version: 1, ...x }).success;
    expect(mal({ vertical: { pack: "ferreteria-magica" } })).toBe(false);
    expect(mal({ vertical: { pack: "default", overrides: { componente: "X" } } })).toBe(false);
    expect(mal({ vertical: { pack: "default", extra: 1 } })).toBe(false);
    expect(mal({ fichaFields: { fields: [{ key: "notas", label: "N", type: "text" }] } })).toBe(false);
    expect(mal({ fichaFields: { fields: [] } })).toBe(true);
    expect(mal({ vertical: { pack: "clinica-salud", overrides: null } })).toBe(true);
  });

  it("un secreto pegado en la descripción de un campo se rechaza", () => {
    const r = blueprintSchema.safeParse({
      version: 1,
      fichaFields: { fields: [{ key: "x_y", label: "X", type: "text", description: `sk-${"a".repeat(30)}` }] },
    });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("secreto_detectado");
  });
});

describe("aplicar las secciones nuevas", () => {
  const existente = { id: "org_1", name: "Clínica Sol", slug: "clinica-sol", metadata: null, modules: null };

  it("cambiar de pack guarda el pack y no aplica su semilla", async () => {
    fake().responder(schema.organization, [existente]);
    fake().responder(schema.organization, [{ pack: "default", overrides: null }]);
    const r = await aplicarBlueprint(actor, { organizationId: "org_1" }, { version: 1, vertical: { pack: "clinica-salud" } });
    expect(r.sections).toEqual({ vertical: "actualizada" });
    const [upd] = fake().de(schema.organization, "update");
    expect(upd?.valores).toEqual({ verticalPack: "clinica-salud", verticalOverrides: null });
    expect(fake().de(schema.pipelineStage, "insert")).toHaveLength(0);
    expect(fake().de(schema.agentProfile, "update")).toHaveLength(0);
  });

  it("el mismo pack y ajustes = sin cambios (idempotente)", async () => {
    const overrides = { nav: { ocultas: ["/results"] } };
    fake().responder(schema.organization, [existente]);
    fake().responder(schema.organization, [{ pack: "clinica-salud", overrides }]);
    const r = await aplicarBlueprint(actor, { organizationId: "org_1" }, { version: 1, vertical: { pack: "clinica-salud", overrides } });
    expect(r.sections).toEqual({ vertical: "sin_cambios" });
    expect(fake().de(schema.organization, "update")).toHaveLength(0);
  });

  it("los campos de la ficha: mismo esquema = sin cambios; cambiar un tipo = 422", async () => {
    const campos = semillaDe("eventos-mobiliario").fichaFields!.fields;
    fake().responder(schema.organization, [existente]);
    fake().responder(schema.organization, [{ fichaFields: { version: 1, fields: campos } }]);
    const r = await aplicarBlueprint(actor, { organizationId: "org_1" }, { version: 1, fichaFields: { fields: campos } });
    expect(r.sections).toEqual({ fichaFields: "sin_cambios" });

    fake().reiniciar();
    fake().responder(schema.organization, [existente]);
    fake().responder(schema.organization, [{ fichaFields: { version: 1, fields: campos } }]);
    const cambiado = campos.map((c) => (c.key === "num_invitados" ? { ...c, type: "text" as const } : c));
    const err = await aplicarBlueprint(actor, { organizationId: "org_1" }, { version: 1, fichaFields: { fields: cambiado } }).catch((e) => e);
    expect(err).toBeInstanceOf(BlueprintError);
    expect((err as BlueprintError).code).toBe("tipo_inmutable");
    expect((err as BlueprintError).issues[0]?.path).toBe("fichaFields.fields.num_invitados");
  });

  it("advertencias: un href que no existe o un widget de módulo se guardan pero no se ven", () => {
    expect(
      advertenciasDeOverrides({ nav: { ocultas: ["/results", "/m/mobiliario"] }, inicio: { widgets: [{ tipo: "mobiliario.cotizaciones" }] } })
    ).toEqual(["href_desconocido:/m/mobiliario", "widget_sin_modulo:mobiliario.cotizaciones"]);
    expect(advertenciasDeOverrides(null)).toEqual([]);
  });
});

describe("exportar", () => {
  const filaOrg = (extra: Record<string, unknown>) => ({
    id: "org_1",
    name: "Negocio",
    slug: "negocio",
    metadata: null,
    modules: null,
    brainDeploymentId: null,
    verticalPack: "default",
    verticalOverrides: null,
    fichaFields: null,
    ...extra,
  });

  it("un negocio sin nicho ni campos exporta lo de siempre (sin `vertical` ni `fichaFields`)", async () => {
    fake().responder(schema.organization, [filaOrg({})]);
    const bp = await exportarBlueprint("org_1");
    expect(bp).not.toHaveProperty("vertical");
    expect(bp).not.toHaveProperty("fichaFields");
  });

  it("con nicho y campos, los exporta (y aplicar lo exportado es válido)", async () => {
    const campos = semillaDe("clinica-salud").fichaFields!.fields;
    fake().responder(schema.organization, [filaOrg({ verticalPack: "clinica-salud", fichaFields: { version: 1, fields: campos } })]);
    const bp = await exportarBlueprint("org_1");
    expect(bp?.vertical).toEqual({ pack: "clinica-salud" });
    expect(bp?.fichaFields?.fields).toEqual(campos);
    expect(blueprintSchema.safeParse(bp).success).toBe(true);
  });
});

describe("el formulario de /platform", () => {
  it("«Empezar desde plantilla» precarga la semilla y deja el negocio en blanco", () => {
    const f = formularioDesdePlantilla("clinica-salud", DEFAULTS, TECHO);
    expect(f.organization).toEqual({ name: "", slug: "", slugTocado: false });
    expect(f.vertical.pack).toBe("clinica-salud");
    expect(f.agent.name).toBe("Sofía");
    expect(f.agent.treatment).toBe("usted");
    expect(f.pipeline.stages[1]).toBe("Valoración agendada");
    expect(f.fichaFields.fields).toHaveLength(PACKS["clinica-salud"].fichaFields.length);
    expect(f.brand.accent).toBe("#3f6b66");
    f.organization.name = "Clínica Sol";
    const { blueprint, modificadas } = blueprintParaEnviar(f, "crear", TECHO);
    expect(modificadas).toEqual(expect.arrayContaining(["vertical", "fichaFields", "pipeline", "agent", "knowledge", "quickReplies", "appearance"]));
    expect(blueprintSchema.safeParse(blueprint).success).toBe(true);
  });

  it("crear sin plantilla no manda `vertical` ni `fichaFields` (lo de 2.11.0)", () => {
    const f = formularioInicial(DEFAULTS, TECHO);
    f.organization.name = "Ferretería";
    const { modificadas } = blueprintParaEnviar(f, "crear", TECHO);
    expect(modificadas).not.toContain("vertical");
    expect(modificadas).not.toContain("fichaFields");
  });

  it("editar sin tocar nada no marca nicho ni ficha; cargar la plantilla sí", () => {
    const bp = { version: 1 as const, organization: { slug: "x", name: "X" }, knowledge: { mode: "exact" as const, entries: [{ kind: "qa" as const, question: "¿Precio?", answer: "10" }] } };
    const f = formularioDesdeBlueprint(bp, DEFAULTS, TECHO);
    const base = seccionesDelFormulario(f, "editar", TECHO);
    expect(blueprintParaEnviar(f, "editar", TECHO, base).modificadas).toEqual([]);

    const g = aplicarPlantillaAlFormulario(f, "eventos-mobiliario", DEFAULTS, TECHO);
    const { modificadas, blueprint } = blueprintParaEnviar(g, "editar", TECHO, base);
    expect(modificadas).toEqual(expect.arrayContaining(["vertical", "fichaFields", "pipeline", "agent", "knowledge"]));
    expect(modificadas).not.toContain("organization");
    // El conocimiento se SUMA: lo del negocio sigue primero.
    const kb = (blueprint.knowledge as { mode: string; entries: { question?: string }[] });
    expect(kb.mode).toBe("merge");
    expect(kb.entries[0]?.question).toBe("¿Precio?");
    // Cargarla dos veces no duplica nada.
    const h2 = aplicarPlantillaAlFormulario(g, "eventos-mobiliario", DEFAULTS, TECHO);
    expect(h2.knowledge.entries).toHaveLength(g.knowledge.entries.length);
    expect(h2.quickReplies.entries).toHaveLength(g.quickReplies.entries.length);
  });
});

describe("MCP y catálogo", () => {
  const herramienta = (n: string) => herramientas().find((x) => x.name === n)!;
  const actorMcp = { userId: "u", via: "mcp" } as never;

  it("list_vertical_packs y el catálogo traen los tres nichos", async () => {
    const r = (await herramienta("list_vertical_packs").run(actorMcp, {})) as { packs: { id: string }[] };
    expect(r.packs.map((p) => p.id)).toEqual(["default", "clinica-salud", "eventos-mobiliario"]);
    expect(listaDePacks().find((p) => p.id === "eventos-mobiliario")).toMatchObject({ hasHome: true, recommendedModules: ["mobiliario"] });
    const c = catalogoPlataforma() as unknown as { verticalPacks: unknown[]; fichaFields: { maxFields: number } };
    expect(c.verticalPacks).toHaveLength(3);
    expect(c.fichaFields.maxFields).toBe(20);
  });

  it("get_vertical_pack devuelve una semilla aplicable; uno desconocido es error", async () => {
    const r = (await herramienta("get_vertical_pack").run(actorMcp, { id: "clinica-salud" })) as { pack: { seed: object } };
    expect(blueprintSchema.safeParse({ version: 1, organization: { slug: "clinica-sol", name: "Clínica Sol" }, ...r.pack.seed }).success).toBe(true);
    await expect(herramienta("get_vertical_pack").run(actorMcp, { id: "nada" })).rejects.toBeInstanceOf(ErrorHerramienta);
    expect(detalleDePack("__proto__")).toBeNull();
    expect(herramienta("get_vertical_pack").scope).toBe("read");
    expect(herramienta("list_vertical_packs").annotations.readOnlyHint).toBe(true);
  });
});
