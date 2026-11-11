import { describe, expect, it } from "vitest";
import { HANDOFF_LABEL } from "@/lib/analytics";
import { HANDOFF_LABELS } from "@/lib/eventos-hilo";
import { HANDOFF_REASONS, toHandoffReason } from "@/server/bot/handoff";

/**
 * 071 (3.7, D10 de Aliantis) — Los motivos que manda aliantis-brain
 * (`src/vocero/motivos.ts`, `MotivoVocero`), copiados aquí a mano: si el
 * cerebro agrega uno, esta lista se actualiza con él.
 */
const DEL_CEREBRO = [
  "cliente",
  "salud",
  "reclamo",
  "no_entiende",
  "agendar",
  "error",
  "tope_gasto",
  "medios",
  "modelo",
] as const;

describe("071 — motivos de Aliantis", () => {
  it.each(DEL_CEREBRO)("«%s» se guarda tal cual, nunca cae en modelo", (motivo) => {
    expect(toHandoffReason(motivo)).toBe(motivo);
    expect(toHandoffReason(` ${motivo.toUpperCase()} `)).toBe(motivo);
  });

  it("cada motivo del catálogo tiene rótulo en Resultados y en el hilo", () => {
    for (const motivo of HANDOFF_REASONS) {
      expect(HANDOFF_LABEL[motivo], motivo).toBeTruthy();
      expect(HANDOFF_LABELS[motivo], motivo).toBeTruthy();
    }
  });

  it("lo desconocido sigue cayendo en modelo", () => {
    expect(toHandoffReason("porque se enojó")).toBe("modelo");
  });
});
