import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { baseGrabadora } from "./fixtures/base-grabadora";

/**
 * 071 (3.6, D12) — El texto libre que escribe el equipo o el cerebro (notas
 * internas, ficha) pasa por el filtro antes de guardarse.
 */
const h = vi.hoisted(() => ({
  politica: null as unknown,
  base: null as unknown as ReturnType<
    typeof import("./fixtures/base-grabadora").baseGrabadora
  >,
}));

vi.mock("@/server/privacy/repositorio", () => ({
  perfilDePrivacidad: vi.fn(async () => h.politica),
}));
vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db")>();
  return { ...original, getDb: () => h.base.db };
});
vi.mock("@/server/events/bus", () => ({ publish: vi.fn() }));
vi.mock("@/server/attribution/conversions", () => ({
  reportStageChange: vi.fn(async () => undefined),
}));

import { schema } from "@/lib/db";
import { upsertFicha } from "@/server/bot/ficha";
import { moveLeadToStage } from "@/server/leads/stage-history";
import { crearNota } from "@/server/notas";
import { filtrarTextoLibre } from "@/server/privacy/filtrar";
import {
  politicaDesdePerfil,
  type PerfilPrivacidad,
} from "@/server/privacy/perfil";
import {
  HEALTH_OMITTED_TEXT,
  UNREVIEWED_TEXT,
} from "@/server/privacy/privacy-filter";

const vectores = JSON.parse(
  readFileSync("tests/unit/fixtures/privacidad-vectores.json", "utf8"),
) as { perfiles: Record<string, PerfilPrivacidad> };
const DENTAL = politicaDesdePerfil(vectores.perfiles["dental-co"]!);

beforeEach(() => {
  h.politica = DENTAL;
  h.base = baseGrabadora();
});

describe("071 — filtrarTextoLibre", () => {
  it("omite la salud y enmascara los datos personales", async () => {
    expect(
      await filtrarTextoLibre("org_1", "tiene diabetes y le duele la muela"),
    ).toBe(HEALTH_OMITTED_TEXT);
    expect(await filtrarTextoLibre("org_1", "llamar al cel 3001234567")).toBe(
      "llamar al cel [telefono]",
    );
  });

  it("sin perfil legible, el texto no se guarda", async () => {
    h.politica = null;
    expect(await filtrarTextoLibre("org_1", "llamar mañana")).toBe(
      UNREVIEWED_TEXT,
    );
  });

  it("null y undefined pasan tal cual", async () => {
    expect(await filtrarTextoLibre("org_1", null)).toBeNull();
    expect(await filtrarTextoLibre("org_1", undefined)).toBeUndefined();
  });
});

describe("071 — la nota interna", () => {
  it("se guarda filtrada", async () => {
    h.base.responder(schema.conversation, [{ id: "cv_1" }]);
    h.base.responder(schema.conversationNote, [
      {
        id: "nota_1",
        organizationId: "org_1",
        conversationId: "cv_1",
        authorUserId: "u_1",
        texto: HEALTH_OMITTED_TEXT,
        createdAt: new Date(),
      },
    ]);
    await crearNota(
      { organizationId: "org_1", userId: "u_1", configura: true },
      "cv_1",
      "el paciente tiene diabetes, cel 3001234567",
    );
    const insert = h.base.ops.find(
      (o) => o.op === "insert" && o.tabla === schema.conversationNote,
    );
    expect(insert?.valores).toMatchObject({ texto: HEALTH_OMITTED_TEXT });
    expect(JSON.stringify(insert?.valores)).not.toContain("3001234567");
  });
});

describe("071 — la ficha", () => {
  it("los valores de texto se guardan filtrados; números y booleanos no se tocan", async () => {
    h.base.responder(schema.contact, [{ ficha: { previo: "x" } }]);
    const r = await upsertFicha({
      organizationId: "org_1",
      contactId: "ct_1",
      ficha: {
        motivo: "le duele la muela",
        telefono_alt: "3001234567",
        presupuesto: 300,
        urgente: true,
      },
    });
    expect(r?.ficha).toEqual({
      previo: "x",
      motivo: HEALTH_OMITTED_TEXT,
      telefono_alt: "[telefono]",
      presupuesto: 300,
      urgente: true,
    });
    const update = h.base.ops.find(
      (o) => o.op === "update" && o.tabla === schema.contact,
    );
    expect(JSON.stringify(update?.valores)).not.toMatch(/muela|3001234567/);
  });
});

describe("072 (D8) — la nota de pérdida del pipeline", () => {
  it("se guarda filtrada al mover el lead a una etapa perdida", async () => {
    h.base.responder(schema.lead, [
      {
        lead: { id: "ld_1", stageId: "st_abierta", contactId: "ct_1" },
        stage: { id: "st_abierta", kind: "open", name: "Nuevo" },
      },
    ]);
    h.base.responder(schema.pipelineStage, [
      { id: "st_perdida", kind: "lost", name: "Perdido" },
    ]);
    h.base.responder(schema.lead, [{ id: "ld_1", contactId: "ct_1" }]);
    const r = await moveLeadToStage({
      organizationId: "org_1",
      leadId: "ld_1",
      toStageId: "st_perdida",
      source: "dueno",
      lossReason: "precio",
      lossNote: "no volvió, tiene diabetes; su cel 3001234567",
    });
    expect(r.ok).toBe(true);
    const evento = h.base.ops.find(
      (o) => o.op === "insert" && o.tabla === schema.leadStageEvent,
    );
    expect(evento?.valores).toMatchObject({
      lossReason: "precio",
      lossNote: HEALTH_OMITTED_TEXT,
    });
    expect(JSON.stringify(evento?.valores)).not.toMatch(/diabetes|3001234567/);
  });
});
