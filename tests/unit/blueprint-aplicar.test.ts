import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/lib/db";
import type { FakeDb } from "./helpers/fake-db";

/**
 * 069 (D12, US2, US8) — `aplicarBlueprint` y `exportarBlueprint` contra una
 * base falsa que registra lo que se escribe. Las respuestas de cada SELECT se
 * encolan por tabla, en el orden en que el servicio consulta.
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

import { aplicarBlueprint, BlueprintError } from "@/server/platform/blueprint/aplicar";
import { exportarBlueprint } from "@/server/platform/blueprint/exportar";
import { hashToken } from "@/server/platform/invitaciones";

const fake = () => h.fake!;
const actor = { userId: "u_ops", via: "api" as const, tokenId: "pat_1" };

beforeEach(() => {
  fake().reiniciar();
  vi.stubEnv("TENANCY", "multi");
  vi.stubEnv("PLATFORM_BASE_DOMAIN", "aliantis.co");
  vi.stubEnv("AGENDA", "on");
});
afterEach(() => vi.unstubAllEnvs());

describe("069 — crear por Blueprint", () => {
  const bp = {
    version: 1,
    organization: { slug: "ferreteria-rojas", name: "Ferretería Rojas" },
    region: { country: "CO", locale: "es-CO", timezone: "America/Bogota" },
    owner: { email: "Dueno@Ferreteria.co" },
  };

  it("crea la organización sembrada, con región, marca e invitación de un uso", async () => {
    const r = await aplicarBlueprint(actor, { crear: true }, bp);
    expect(r.created).toBe(true);
    expect(r.slug).toBe("ferreteria-rojas");
    expect(r.sections).toMatchObject({ organization: "creada", region: "creada", brand: "creada", owner: "creada" });

    const [org] = fake().de(schema.organization, "insert");
    expect(org?.valores).toMatchObject({ slug: "ferreteria-rojas", name: "Ferretería Rojas", status: "activa" });
    expect(fake().de(schema.pipelineStage, "insert")).toHaveLength(5);
    expect(fake().de(schema.agentProfile, "insert")).toHaveLength(1);

    const meta = JSON.parse(String(fake().de(schema.organization, "update")[0]?.valores.metadata));
    expect(meta.region).toEqual({ country: "CO", locale: "es-CO", timezone: "America/Bogota" });
    expect(meta.branding.name).toBe("Ferretería Rojas");

    expect(r.invitation?.status).toBe("creada");
    const url = r.invitation && "url" in r.invitation ? r.invitation.url : "";
    expect(url).toMatch(/^https:\/\/ferreteria-rojas\.aliantis\.co\/invitacion\/[\w-]{43}$/);
    const token = url.split("/").pop()!;
    const [inv] = fake().de(schema.invitation, "insert");
    expect(inv?.valores).toMatchObject({ email: "dueno@ferreteria.co", role: "owner", status: "pending" });
    expect(inv?.valores.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(fake().escrituras.map((e) => e.valores))).not.toContain(token);

    const acciones = fake().de(schema.platformAuditLog).map((e) => e.valores.action);
    expect(acciones).toEqual(["organizacion_creada", "invitacion_creada", "blueprint_aplicado"]);
    expect(fake().de(schema.platformAuditLog)[2]?.valores).toMatchObject({ via: "api", tokenId: "pat_1" });
  });

  it("un Blueprint completo crea todas sus secciones en la misma transacción", async () => {
    // Al crear, las consultas de las secciones ven la organización recién sembrada.
    fake().responder(schema.organization, []); // slug libre
    fake().responder(schema.pipelineStage, [
      { id: "stg_1", name: "Nuevo", position: 0, kind: "open" },
      { id: "stg_2", name: "En conversación", position: 1, kind: "open" },
      { id: "stg_3", name: "Interesado", position: 2, kind: "open" },
      { id: "stg_w", name: "Cliente", position: 3, kind: "won" },
      { id: "stg_l", name: "Perdido", position: 4, kind: "lost" },
    ]);
    fake().responder(schema.lead, []);
    fake().responder(schema.agentProfile, [
      { id: "agp_1", name: "Asistente", tone: null, role: "calificador", tools: null, instructions: null, escalationRules: null, greeting: null },
    ]);
    fake().responder(schema.kbEntry, []);
    const r = await aplicarBlueprint(actor, { crear: true }, {
      ...bp,
      owner: undefined,
      modules: { agenda: true },
      pipeline: { stages: ["Nuevo", "Cotización", "Negociando"] },
      agent: { name: "Sofía", greeting: "¡Hola!" },
      knowledge: { entries: [{ kind: "qa", question: "¿Horario?", answer: "8 a 6" }] },
      agenda: { weeklyHours: { mon: [{ start: "08:00", end: "17:00" }] }, slotMinutes: 45 },
    });
    expect(r.sections).toMatchObject({
      modules: "creada",
      pipeline: "creada",
      agent: "creada",
      knowledge: "creada",
      agenda: "creada",
    });
    // «En conversación» e «Interesado» no tienen leads: se borran; «Nuevo» se conserva.
    expect(fake().de(schema.pipelineStage, "delete")).toHaveLength(2);
    expect(fake().de(schema.agentProfile, "update")[0]?.valores).toMatchObject({ name: "Sofía", greeting: "¡Hola!" });
    expect(fake().de(schema.kbEntry, "insert")[0]?.valores).toMatchObject({ kind: "qa", question: "¿Horario?" });
    expect(fake().de(schema.calendarSettings, "insert")[0]?.valores).toMatchObject({ slotMinutes: 45 });
    // La auditoría lleva conteos, no textos del negocio.
    const audit = fake().de(schema.platformAuditLog).at(-1)?.valores;
    expect(JSON.stringify(audit)).not.toContain("Horario");
    expect((audit?.detail as { counts: unknown }).counts).toEqual({
      knowledge: { creadas: 1, actualizadas: 0, borradas: 0 },
    });
  });

  it("slug en uso → 409 sin escribir nada", async () => {
    fake().responder(schema.organization, [{ id: "org_otro" }]);
    await expect(aplicarBlueprint(actor, { crear: true }, bp)).rejects.toMatchObject({
      code: "slug_en_uso",
      status: 409,
    });
    expect(fake().escrituras).toEqual([]);
  });

  it("sin slug o sin nombre → 422", async () => {
    await expect(
      aplicarBlueprint(actor, { crear: true }, { version: 1, organization: { name: "X" } })
    ).rejects.toMatchObject({ code: "slug_requerido" });
    await expect(
      aplicarBlueprint(actor, { crear: true }, { version: 1, organization: { slug: "abc" } })
    ).rejects.toMatchObject({ code: "nombre_requerido" });
  });

  it("Blueprint inválido → 422 con la ruta exacta", async () => {
    const err = await aplicarBlueprint(actor, { crear: true }, { ...bp, brand: { accent: "azul" } }).catch((e) => e);
    expect(err).toBeInstanceOf(BlueprintError);
    expect(err.issues).toEqual([{ path: "brand.accent", message: "color_invalido" }]);
  });

  it("`dryRun`: el plan sin URL de invitación, y solo queda la auditoría del plan", async () => {
    const r = await aplicarBlueprint(actor, { crear: true }, bp, { dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(r.invitation).toEqual({ status: "se_generaria" });
    expect(fake().de(schema.invitation, "insert")).toEqual([]);
    const ultima = fake().de(schema.platformAuditLog).at(-1)?.valores;
    expect(ultima).toMatchObject({ action: "blueprint_aplicado", organizationId: null });
    expect((ultima?.detail as { dryRun: boolean }).dryRun).toBe(true);
  });
});

/** Una organización ya configurada, tal como la vería la base. */
const fila = {
  id: "org_A",
  name: "Clínica Sol",
  slug: "clinica-sol",
  metadata: JSON.stringify({
    region: { country: "MX", locale: "es-MX", timezone: "America/Mexico_City" },
    branding: { name: "Clínica Sol", accent: "#10c4a5", currency: "MXN", favicon: null },
  }),
  modules: { agenda: true },
  status: "activa",
  createdAt: new Date(),
  suspendedAt: null,
  logo: null,
};
const etapas = [
  { id: "stg_1", name: "Nuevo", position: 0, kind: "open" },
  { id: "stg_2", name: "Cita agendada", position: 1, kind: "open" },
  { id: "stg_w", name: "Cliente", position: 2, kind: "won" },
  { id: "stg_l", name: "Perdido", position: 3, kind: "lost" },
];
const perfil = {
  id: "agp_1",
  name: "Sofía",
  tone: "cálido",
  role: "calificador",
  tools: null,
  instructions: "Agenda citas.",
  escalationRules: null,
  greeting: "¡Hola!",
};
const kb = [
  { id: "kb_1", kind: "qa", question: "¿Horario?", answer: "8 a 6", content: null },
  { id: "kb_2", kind: "block", question: null, answer: null, content: "Aceptamos tarjetas." },
];
const calendario = {
  weeklyHours: { mon: [{ start: "08:00", end: "12:00" }] },
  slotMinutes: 30,
  bufferMinutes: 0,
  minNoticeHours: 2,
  maxDaysAhead: 7,
  timezone: "America/Mexico_City",
  connector: "enlace-fijo",
  meetingLink: null,
};

/** Encola lo que leerá UNA aplicación completa sobre la organización. */
function encolarEstado() {
  fake().responder(schema.organization, [fila]);
  fake().responder(schema.pipelineStage, etapas);
  fake().responder(schema.lead, []);
  fake().responder(schema.agentProfile, [perfil]);
  fake().responder(schema.kbEntry, kb);
  fake().responder(schema.calendarSettings, [{ id: "cal_1" }]); // ¿hay fila?
  fake().responder(schema.calendarSettings, [calendario]); // getSettings
}

describe("069 — aplicar sobre una existente (idempotencia)", () => {
  it("exportar y volver a aplicar → todo `sin_cambios`, ninguna escritura salvo la auditoría", async () => {
    // exportarBlueprint lee: organización, etapas, perfil, conocimiento, ¿agenda?, agenda.
    fake().responder(schema.organization, [fila]);
    fake().responder(schema.pipelineStage, etapas);
    fake().responder(schema.agentProfile, [perfil]);
    fake().responder(schema.kbEntry, kb);
    fake().responder(schema.calendarSettings, [{ id: "cal_1" }]);
    fake().responder(schema.calendarSettings, [calendario]);
    const exportado = await exportarBlueprint("org_A");
    expect(exportado).toMatchObject({
      organization: { slug: "clinica-sol", name: "Clínica Sol" },
      pipeline: { stages: ["Nuevo", "Cita agendada"] },
      knowledge: { mode: "exact" },
    });
    expect(exportado).not.toHaveProperty("owner");

    encolarEstado();
    const r = await aplicarBlueprint(actor, { organizationId: "org_A" }, exportado);
    expect(Object.values(r.sections).every((s) => s === "sin_cambios")).toBe(true);
    expect(Object.keys(r.sections).sort()).toEqual(
      ["agenda", "agent", "brand", "knowledge", "modules", "organization", "pipeline", "region"].sort()
    );
    expect(fake().escrituras.filter((e) => e.tabla !== schema.platformAuditLog)).toEqual([]);
  });

  it("solo cambia lo que trae; lo ausente no se toca", async () => {
    fake().responder(schema.organization, [fila]);
    const r = await aplicarBlueprint(actor, { organizationId: "org_A" }, { version: 1, region: { locale: "es-CO" } });
    expect(r.sections).toEqual({ region: "actualizada" });
    const meta = JSON.parse(String(fake().de(schema.organization, "update")[0]?.valores.metadata));
    expect(meta.region).toEqual({ country: "MX", locale: "es-CO", timezone: "America/Mexico_City" });
    expect(meta.branding.accent).toBe("#10c4a5");
  });

  it("una etapa con leads que el Blueprint omite se conserva y se advierte", async () => {
    fake().responder(schema.organization, [fila]);
    fake().responder(schema.pipelineStage, etapas);
    fake().responder(schema.lead, [{ stageId: "stg_2", n: 3 }]);
    const r = await aplicarBlueprint(actor, { organizationId: "org_A" }, { version: 1, pipeline: { stages: ["Nuevo"] } });
    expect(r.warnings).toContain("etapa_con_leads_conservada:Cita agendada");
    expect(fake().de(schema.pipelineStage, "delete")).toEqual([]);
  });

  it("conocimiento `exact` borra lo que sobra; `merge` nunca borra", async () => {
    fake().responder(schema.organization, [fila]);
    fake().responder(schema.kbEntry, kb);
    await aplicarBlueprint(actor, { organizationId: "org_A" }, {
      version: 1,
      knowledge: { mode: "merge", entries: [{ kind: "qa", question: "¿Domicilio?", answer: "Sí" }] },
    });
    expect(fake().de(schema.kbEntry, "delete")).toEqual([]);
    expect(fake().de(schema.kbEntry, "insert")).toHaveLength(1);

    fake().reiniciar();
    fake().responder(schema.organization, [fila]);
    fake().responder(schema.kbEntry, kb);
    await aplicarBlueprint(actor, { organizationId: "org_A" }, {
      version: 1,
      knowledge: { mode: "exact", entries: [{ kind: "qa", question: " ¿horario? ", answer: "8 a 6" }] },
    });
    expect(fake().de(schema.kbEntry, "delete")).toHaveLength(1);
    expect(fake().de(schema.kbEntry, "insert")).toEqual([]);
  });

  it("agenda con el módulo apagado en la organización: se guarda y se advierte", async () => {
    fake().responder(schema.organization, [{ ...fila, modules: { agenda: false } }]);
    fake().responder(schema.calendarSettings, []);
    const r = await aplicarBlueprint(actor, { organizationId: "org_A" }, { version: 1, agenda: { slotMinutes: 60 } });
    expect(r.sections.agenda).toBe("actualizada");
    expect(r.warnings).toContain("modulo_apagado:agenda");
  });

  it("el slug es inmutable", async () => {
    fake().responder(schema.organization, [fila]);
    await expect(
      aplicarBlueprint(actor, { organizationId: "org_A" }, { version: 1, organization: { slug: "otra-cosa" } })
    ).rejects.toMatchObject({ code: "slug_inmutable" });
  });

  it("organización inexistente → 404", async () => {
    await expect(aplicarBlueprint(actor, { organizationId: "org_X" }, { version: 1 })).rejects.toMatchObject({
      code: "organizacion_inexistente",
      status: 404,
    });
  });

  it("owner con invitación pendiente → `pendiente`, sin enlace nuevo", async () => {
    fake().responder(schema.organization, [fila]);
    fake().responder(schema.member, []);
    fake().responder(schema.invitation, [{ id: "inv_1", expiresAt: new Date(Date.now() + 1e6) }]);
    const r = await aplicarBlueprint(actor, { organizationId: "org_A" }, { version: 1, owner: { email: "a@b.co" } });
    expect(r.invitation).toEqual({ status: "pendiente" });
    expect(r.sections.owner).toBe("sin_cambios");
    expect(fake().de(schema.invitation, "insert")).toEqual([]);
  });

  it("owner que ya es miembro → `ya_miembro`", async () => {
    fake().responder(schema.organization, [fila]);
    fake().responder(schema.member, [{ id: "mem_1" }]);
    const r = await aplicarBlueprint(actor, { organizationId: "org_A" }, { version: 1, owner: { email: "a@b.co" } });
    expect(r.invitation).toEqual({ status: "ya_miembro" });
  });

  it("`regenerate` revoca la pendiente y emite un enlace nuevo", async () => {
    fake().responder(schema.organization, [fila]);
    fake().responder(schema.member, []);
    fake().responder(schema.invitation, [{ id: "inv_1", expiresAt: new Date(Date.now() + 1e6) }]);
    const r = await aplicarBlueprint(
      actor,
      { organizationId: "org_A" },
      { version: 1, owner: { email: "a@b.co", regenerate: true } }
    );
    expect(r.invitation?.status).toBe("creada");
    expect(fake().de(schema.invitation, "update")[0]?.valores).toEqual({ status: "canceled" });
  });
});
