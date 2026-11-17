import { describe, expect, it } from "vitest";
import { blueprintJsonSchema, blueprintSchema } from "@/lib/platform/blueprint";

/** 069 (FR-016) — El contrato `OrganizationBlueprint` v1. */

const minimo = { version: 1, organization: { slug: "ferreteria-rojas", name: "Ferretería Rojas" } };

function errores(valor: unknown): string[] {
  const r = blueprintSchema.safeParse(valor);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}:${i.message}`);
}

describe("069 — OrganizationBlueprint v1", () => {
  it("acepta un Blueprint completo", () => {
    const r = blueprintSchema.safeParse({
      version: 1,
      organization: { slug: "clinica-sol", name: "Clínica Sol" },
      region: { country: "mx", locale: "es-MX", timezone: "America/Mexico_City" },
      brand: { name: "Clínica Sol", accent: "#10C4A5", currency: "MXN" },
      modules: { agenda: true, channels: ["whatsapp"] },
      pipeline: { stages: ["Nuevo", "Cita agendada", "Atendido"] },
      agent: { name: "Sofía", tone: "cálido", role: "calificador", tools: null, greeting: "¡Hola!" },
      knowledge: { entries: [{ kind: "qa", question: "¿Horario?", answer: "8 a 6" }] },
      agenda: {
        weeklyHours: { mon: [{ start: "08:00", end: "12:00" }, { start: "14:00", end: "18:00" }] },
        slotMinutes: 30,
      },
      owner: { email: " Duena@Clinica.co " },
    });
    expect(r.success).toBe(true);
    expect(r.data?.region?.country).toBe("MX");
    expect(r.data?.owner?.email).toBe("duena@clinica.co");
    expect(r.data?.knowledge?.mode).toBe("merge");
  });

  it("solo `version: 1`", () => {
    expect(errores({ ...minimo, version: 2 })).not.toEqual([]);
    expect(errores({ organization: minimo.organization })).not.toEqual([]);
  });

  it.each([
    ["Ferreteria", "slug_formato"],
    ["www", "slug_reservado"],
    ["a--b", "slug_guiones"],
  ])("slug inválido %s → %s", (slug, motivo) => {
    expect(errores({ version: 1, organization: { slug, name: "X" } })).toEqual([
      `organization.slug:${motivo}`,
    ]);
  });

  it("campos desconocidos son 422, en cualquier nivel (no hay dónde meter un secreto)", () => {
    expect(errores({ ...minimo, aiKey: "x" })).not.toEqual([]);
    expect(errores({ ...minimo, agent: { enabled: true } })).not.toEqual([]);
    expect(errores({ ...minimo, brand: { whatsappToken: "x" } })).not.toEqual([]);
  });

  it("un texto con forma de llave se rechaza con su ruta", () => {
    expect(
      errores({ ...minimo, agent: { instructions: "usa sk-or-v1-abcdefghijklmnopqrstuvwxyz0123" } })
    ).toEqual(["agent.instructions:secreto_detectado"]);
  });

  it("región, marca y catálogos validados", () => {
    expect(errores({ ...minimo, region: { timezone: "America/Medellin_Inventada" } })).toEqual([
      "region.timezone:zona_invalida",
    ]);
    expect(errores({ ...minimo, region: { country: "Colombia" } })).toEqual(["region.country:pais_invalido"]);
    expect(errores({ ...minimo, brand: { accent: "azul" } })).toEqual(["brand.accent:color_invalido"]);
    expect(errores({ ...minimo, agent: { role: "vendedor-raro" } })).not.toEqual([]);
    expect(errores({ ...minimo, agent: { tools: ["borrar_todo"] } })).not.toEqual([]);
    expect(errores({ ...minimo, modules: { channels: ["instagram"] } })).not.toEqual([]);
  });

  it("etapas repetidas y horarios solapados o invertidos", () => {
    expect(errores({ ...minimo, pipeline: { stages: ["Nuevo", " nuevo "] } })).toEqual([
      "pipeline.stages:etapas_repetidas",
    ]);
    expect(
      errores({
        ...minimo,
        agenda: { weeklyHours: { mon: [{ start: "08:00", end: "12:00" }, { start: "11:00", end: "13:00" }] } },
      })
    ).toEqual(["agenda.weeklyHours:horarios_solapados"]);
    expect(errores({ ...minimo, agenda: { weeklyHours: { mon: [{ start: "12:00", end: "08:00" }] } } })).not.toEqual(
      []
    );
  });

  it("límites de la UI: 500 entradas de conocimiento, 20 etapas", () => {
    const entries = Array.from({ length: 501 }, (_, i) => ({ kind: "block", content: `b${i}` }));
    expect(errores({ ...minimo, knowledge: { entries } })).not.toEqual([]);
    const stages = Array.from({ length: 21 }, (_, i) => `E${i}`);
    expect(errores({ ...minimo, pipeline: { stages } })).not.toEqual([]);
  });

  it("solo el conector sin credenciales", () => {
    expect(errores({ ...minimo, agenda: { connector: "zoom" } })).not.toEqual([]);
  });

  it("exporta su JSON Schema (para el MCP)", () => {
    const s = blueprintJsonSchema() as { type?: string; properties?: Record<string, unknown> };
    expect(s.type).toBe("object");
    expect(Object.keys(s.properties ?? {})).toEqual(
      expect.arrayContaining(["version", "organization", "agent", "knowledge", "owner"])
    );
  });
});
