import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 073-A — Cero silencios y cero apagones (lado CRM):
 * - `bot_incident`: registro agrupado, nota del sistema solo la primera vez.
 * - El gate de saldo de `despacharAlCerebro`.
 * - El pool del worker (4 carriles, 2 por organización).
 * - Pasajero vs. definitivo en la respuesta del cerebro.
 * - Motivos de handoff nuevos.
 */

const h = vi.hoisted(() => ({
  conteo: 1,
  falla: false,
  inserts: [] as { values: Record<string, unknown>; conflicto: unknown }[],
  crearNota: vi.fn(async (_org: string, _conv: string, _texto: string) => null),
}));

vi.mock("@/lib/db", async (original) => {
  const real = await original<typeof import("@/lib/db")>();
  return {
    ...real,
    getDb: () => ({
      insert: () => ({
        values: (values: Record<string, unknown>) => ({
          onConflictDoUpdate: (conflicto: unknown) => ({
            returning: async () => {
              if (h.falla) throw new Error("base caída");
              h.inserts.push({ values, conflicto });
              return [{ count: h.conteo }];
            },
          }),
        }),
      }),
      execute: async () => ({ count: 0 }),
    }),
  };
});
vi.mock("@/server/notas", () => ({ crearNotaDelSistema: h.crearNota }));

import {
  avisarCaidaDelCerebro,
  cuboHora,
  registrarIncidente,
  RETENCION_INCIDENTES_MS,
} from "@/server/incidentes";

beforeEach(() => {
  h.conteo = 1;
  h.falla = false;
  h.inserts.length = 0;
  h.crearNota.mockClear();
});

describe("registrarIncidente", () => {
  it("la primera vez de una clave devuelve true; las repetidas suman y devuelven false", async () => {
    const base = {
      organizationId: "org_1",
      kind: "sin_saldo" as const,
      dedupeKey: "sin_saldo:2026-11-19T22",
    };
    expect(await registrarIncidente(base)).toBe(true);
    h.conteo = 7;
    expect(await registrarIncidente(base)).toBe(false);
    expect(h.inserts[0]!.values).toMatchObject({
      organizationId: "org_1",
      kind: "sin_saldo",
      dedupeKey: "sin_saldo:2026-11-19T22",
      conversationId: null,
    });
    expect(h.inserts[0]!.values.id).toMatch(/^inc_/);
  });

  it("nunca lanza: registrar un fallo no puede ser otro fallo", async () => {
    h.falla = true;
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      registrarIncidente({ organizationId: "org_1", kind: "sin_saldo", dedupeKey: "k" })
    ).resolves.toBe(false);
    espia.mockRestore();
  });

  it("agrupa por hora UTC y retiene 90 días", () => {
    expect(cuboHora(new Date("2026-11-19T22:41:05Z"))).toBe("2026-11-19T22");
    expect(RETENCION_INCIDENTES_MS).toBe(90 * 24 * 60 * 60 * 1000);
  });
});

describe("avisarCaidaDelCerebro (decisión #3)", () => {
  const caida = {
    organizationId: "org_1",
    conversationId: "cv_1",
    detalle: "el cerebro respondió 503",
    ahora: new Date("2026-11-19T22:10:00Z"),
  };

  it("registra el incidente por conversación y hora, y deja UNA nota interna", async () => {
    await avisarCaidaDelCerebro(caida);
    expect(h.inserts[0]!.values).toMatchObject({
      kind: "despacho_caducado",
      conversationId: "cv_1",
      dedupeKey: "despacho_caducado:cv_1:2026-11-19T22",
    });
    expect(h.crearNota).toHaveBeenCalledTimes(1);
    expect(h.crearNota.mock.calls[0]![0]).toBe("org_1");
    expect(h.crearNota.mock.calls[0]![1]).toBe("cv_1");
    expect(String(h.crearNota.mock.calls[0]![2])).toContain("La IA sigue activa");
  });

  it("si en esa hora ya avisó, no repite la nota", async () => {
    h.conteo = 3;
    await avisarCaidaDelCerebro(caida);
    expect(h.crearNota).not.toHaveBeenCalled();
  });

  it("no toca aiEnabled: el módulo ni menciona la pausa", () => {
    const fuente = readFileSync(join(process.cwd(), "src", "server", "incidentes.ts"), "utf8");
    expect(fuente).not.toMatch(/aiEnabled\s*:/);
    expect(fuente).not.toMatch(/handoffAt\s*:/);
  });

  it("solo ESCRIBE notas del sistema: nunca las lee (guardarraíl de notas)", () => {
    const fuente = readFileSync(join(process.cwd(), "src", "server", "incidentes.ts"), "utf8");
    expect(fuente).not.toMatch(/conversationNote|conversation_note|listarNotas/);
  });
});

describe("motivos de handoff nuevos (073-A)", () => {
  it("el catálogo los acepta y la bandeja y Resultados los nombran", async () => {
    const { HANDOFF_REASONS, toHandoffReason } = await import("@/server/bot/handoff");
    const { HANDOFF_LABELS } = await import("@/lib/eventos-hilo");
    const { HANDOFF_LABEL } = await import("@/lib/analytics");
    for (const motivo of ["sin_saldo", "opt_out", "abuso"]) {
      expect(HANDOFF_REASONS).toContain(motivo);
      expect(toHandoffReason(motivo)).toBe(motivo);
      expect(HANDOFF_LABELS[motivo]).toBeTruthy();
      expect(HANDOFF_LABEL[motivo]).toBeTruthy();
    }
    // Lo desconocido sigue cayendo en `modelo`: nunca 422.
    expect(toHandoffReason("porque se enojó")).toBe("modelo");
  });
});
