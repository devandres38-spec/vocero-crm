import { describe, expect, it } from "vitest";
import { blueprintSchema, type OrganizationBlueprint } from "@/lib/platform/blueprint";
import {
  blueprintParaEnviar,
  copiarALaborables,
  formularioDesdeBlueprint,
  formularioInicial,
  seccionesDelFormulario,
  sugerirSlug,
  type DefaultsForm,
  type TechoForm,
} from "@/lib/platform/formulario-blueprint";
import { EJEMPLO_COMPLETO } from "@/server/platform/catalogo";
import { REGIONES_SUGERIDAS } from "@/lib/region";

/**
 * Auditoría 069 (Fix-C) — El formulario visual de `/platform` produce
 * Blueprints válidos; al editar manda solo lo que cambió; cargar un
 * Blueprint y volverlo a armar no cambia nada.
 */

const CO = REGIONES_SUGERIDAS[0];
const defaults: DefaultsForm = {
  country: CO.country,
  locale: CO.locale,
  timezone: CO.timezone,
  currency: CO.currency,
  accent: "#0d3b9e",
  etapas: ["Nuevo", "En conversación", "Interesado"],
};
const techo: TechoForm = { agenda: true, atribucion: false, channels: ["whatsapp", "instagram"] };

const valido = (bp: unknown) => {
  const r = blueprintSchema.safeParse(bp);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}:${i.message}`);
};

describe("Fix-C — crear desde el formulario", () => {
  it("con solo el nombre: slug sugerido, marca con el nombre y válido", () => {
    const f = formularioInicial(defaults, techo);
    f.organization.name = "Clínica Sol Ñoño";
    const { blueprint } = blueprintParaEnviar(f, "crear", techo);
    expect(blueprint.organization).toEqual({ slug: "clinica-sol-nono", name: "Clínica Sol Ñoño" });
    expect(blueprint.brand).toMatchObject({ name: "Clínica Sol Ñoño", currency: CO.currency });
    expect(blueprint).not.toHaveProperty("agent");
    expect(blueprint).not.toHaveProperty("knowledge");
    expect(blueprint).not.toHaveProperty("agenda");
    expect(valido(blueprint)).toEqual([]);
  });

  it("agenda con turno partido y almuerzo, conocimiento multi-línea con «|», respuestas rápidas y dueño", () => {
    const f = formularioInicial(defaults, techo);
    f.organization.name = "Taller Rojas";
    f.agenda.usar = true;
    f.agenda.weeklyHours.mon = [
      { start: "08:00", end: "12:00" },
      { start: "14:00", end: "18:00" },
    ];
    f.agenda.weeklyHours = copiarALaborables(f.agenda.weeklyHours, "mon");
    f.agenda.weeklyHours.sat = [{ start: "08:00", end: "12:00" }];
    f.agenda.bufferMinutes = 10;
    f.agenda.meetingLink = "https://meet.example.com/taller";
    f.knowledge.entries = [
      { kind: "qa", question: "¿Precios?", answer: "Cambio de aceite: 80.000\nAlineación | balanceo: 60.000" },
      { kind: "block", content: "Horario:\nL–V 8 a 6" },
    ];
    f.quickReplies.entries = [{ shortcut: "/Dirección", text: "Calle 10 # 20-30" }];
    f.agent.todas = false;
    f.agent.tools = ["ficha", "agendar"];
    f.agent.escalationRules = "Si hay queja, pasa a una persona.";
    f.owner.email = "dueno@taller.co";
    const { blueprint } = blueprintParaEnviar(f, "crear", techo);
    expect(valido(blueprint)).toEqual([]);
    const bp = blueprint as OrganizationBlueprint;
    expect(bp.agenda?.weeklyHours?.fri).toHaveLength(2);
    expect(bp.agenda?.weeklyHours?.sun).toBeUndefined();
    expect(bp.agenda).toMatchObject({ connector: "enlace-fijo", bufferMinutes: 10 });
    expect(bp.knowledge?.entries[0]).toMatchObject({ answer: "Cambio de aceite: 80.000\nAlineación | balanceo: 60.000" });
    expect(bp.agent).toMatchObject({ tools: ["ficha", "agendar"], escalationRules: "Si hay queja, pasa a una persona." });
    expect(bp.owner).toEqual({ email: "dueno@taller.co" });
  });

  it("un canal fuera del techo no se manda", () => {
    const f = formularioInicial(defaults, techo);
    f.organization.name = "X negocio";
    f.modules.channels = ["whatsapp", "instagram", "tiktok"];
    expect(seccionesDelFormulario(f, "crear", techo).modules).toEqual({ agenda: true, channels: ["whatsapp", "instagram"] });
  });

  it("sugerirSlug", () => {
    expect(sugerirSlug("  Peluquería  La Única!! ")).toBe("peluqueria-la-unica");
  });
});

describe("Fix-C — editar: solo lo que cambió", () => {
  const bp = blueprintSchema.parse(EJEMPLO_COMPLETO);

  it("cargar el Blueprint y volver a armarlo, sin tocar nada → ninguna sección", () => {
    const f = formularioDesdeBlueprint(bp, defaults, techo);
    const base = seccionesDelFormulario(f, "editar", techo);
    expect(blueprintParaEnviar(f, "editar", techo, base)).toEqual({ blueprint: { version: 1 }, modificadas: [] });
  });

  it("lo que arma de un Blueprint completo es válido y conserva su contenido", () => {
    const f = formularioDesdeBlueprint(bp, defaults, techo);
    const s = seccionesDelFormulario(f, "editar", techo);
    expect(valido({ version: 1, ...s })).toEqual([]);
    expect(s.agenda).toEqual({ ...bp.agenda, meetingLink: null }); // el export siempre lo trae
    expect(s.knowledge).toEqual(bp.knowledge);
    expect(s.quickReplies).toEqual(bp.quickReplies);
    expect(s.appearance).toEqual(bp.appearance);
    expect(s.pipeline).toEqual(bp.pipeline);
  });

  it("cambiar el nombre del agente y una franja → solo `agent` y `agenda`", () => {
    const f = formularioDesdeBlueprint(bp, defaults, techo);
    const base = seccionesDelFormulario(f, "editar", techo);
    f.agent.name = "Valentina";
    f.agenda.weeklyHours.sat = [{ start: "09:00", end: "13:00" }];
    const r = blueprintParaEnviar(f, "editar", techo, base);
    expect(r.modificadas.sort()).toEqual(["agenda", "agent"]);
    expect(Object.keys(r.blueprint).sort()).toEqual(["agenda", "agent", "version"]);
    expect(valido(r.blueprint)).toEqual([]);
  });

  it("al editar, el slug nunca se manda (es inmutable)", () => {
    const f = formularioDesdeBlueprint(bp, defaults, techo);
    const base = seccionesDelFormulario(f, "editar", techo);
    f.organization.name = "Clínica Sol Medellín";
    expect(blueprintParaEnviar(f, "editar", techo, base).blueprint.organization).toEqual({ name: "Clínica Sol Medellín" });
  });

  it("vaciar el conocimiento en modo exact se manda (borrar todo es una edición)", () => {
    const f = formularioDesdeBlueprint(bp, defaults, techo);
    const base = seccionesDelFormulario(f, "editar", techo);
    f.knowledge = { mode: "exact", entries: [] };
    expect(blueprintParaEnviar(f, "editar", techo, base).blueprint.knowledge).toEqual({ mode: "exact", entries: [] });
  });
});
